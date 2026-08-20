// NestedReplyComposer — vendor Flarum 2.0 reply composer extended to
// support a `parentPost` field (the post being replied to).
//
// v0.1.0e.a design (辉哥拍板 2026-08-19 16:24, 撤回 v0.1.0e 的 A2 无限层):
//   - Use the **vendor Flarum 2.0 composer** (走 `app.composer.load(
//     ReplyComposer, ...)` 弹全局 composer 浮层) — NOT a zpc inline
//     textarea composer.
//   - Vendor `flarum/forum/components/ReplyComposer` is a
//     *Discussion-level* composer. We need to inject a `parentPost`
//     field and customize the title to show "回复 @username".
//   - **Avoid subclassing**: vendor's `ReplyComposer` is a **lazy
//     webpack chunk** in Flarum 2.0. Trying to
//     `class NestedReplyComposer extends ReplyComposer` at the
//     top of zpc dist's import time fails with "Class extends
//     value undefined is not a constructor or null", killing the
//     whole zpc initializer (no `Post--nestedClickable`, no
//     `NestedReplies`, no card click handlers).
//   - **Use mithril `extend()` at runtime** via `flarum.reg.onLoad`:
//     register a callback that fires when the vendor ReplyComposer
//     chunk is loaded, then `extend()` the vendor class's prototype
//     with our `initAttrs` / `oninit` / `headerItems` / `data` /
//     `onsubmit` overrides. The vendor class is never touched at
//     zpc dist's import time (no extends), so the chunk can be
//     async-loaded safely.
//   - The default export of this file is the vendor `ReplyComposer`
//     class itself. Callers do
//     `app.composer.load(NestedReplyComposer, { parentPost: post })`
//     which is functionally identical to
//     `app.composer.load(vendor ReplyComposer, { parentPost: post })`
//     once the extends have applied (which happens before any
//     instance is constructed — the `app.composer.load` call
//     itself triggers the chunk load via webpack dynamic import,
//     and our onLoad callback runs in the same microtask).

import app from 'flarum/forum/app';
import { extend, override } from 'flarum/common/extend';
import Link from 'flarum/common/components/Link';
import Icon from 'flarum/common/components/Icon';

// `import` here is fine even though ReplyComposer is a lazy chunk
// — we never reference the binding in zpc's top-level module
// body. We just re-export it. The `app.composer.load(...)` call
// (in index.js / NestedReply.jsx) is what actually triggers the
// chunk load via webpack's dynamic-import path, and our
// `flarum.reg.onLoad` callback below hooks in to apply the
// extends *before* the first instance is constructed.
import ReplyComposer from 'flarum/forum/components/ReplyComposer';

// Apply our extends to the vendor prototype. Idempotent —
// flarum.reg.onLoad fires the callback the first time the chunk
// loads; subsequent calls to get() return the cached module,
// and our onLoad returns early (the callback runs once).
let _extendsApplied = false;
function applyExtends(ReplyComposerClass) {
  if (_extendsApplied) return;
  if (!ReplyComposerClass || !ReplyComposerClass.prototype) return;
  _extendsApplied = true;

  // ---- oninit: extract parentPost from attrs to instance ----
  // We hook `oninit` (NOT `initAttrs`) because vendor
  // `ReplyComposer.initAttrs` mutates `attrs` in place and
  // does NOT return a new object. If we deleted `parentPost`
  // in initAttrs and the value were re-rendered into a DOM
  // attribute, we'd lose the reference; if we re-attached it
  // via a non-enumerable prop, mithril's redraw wouldn't see
  // it. The cleanest place to intercept is `oninit` — by then
  // the instance exists, vendor's initAttrs has finished
  // (mutating attrs), and we can save the value on
  // `this.parentPost` and delete it from `this.attrs` so it
  // doesn't get re-rendered as a DOM attribute on subsequent
  // redraws.
  //
  // We DON'T need to override `initAttrs` because vendor's
  // `initAttrs` is a no-op for the `parentPost` field — it
  // doesn't try to read or write it. It only sets defaults for
  // `placeholder`, `submitLabel`, `confirmExit`. The
  // `parentPost` field is opaque to vendor.
  override(ReplyComposerClass.prototype, 'oninit', function (original, vnode) {
    // 防御性 super-call: vendor oninit 通常无 return, 但万一未来有, 我们尊重
    if (typeof original === 'function') {
      original.call(this, vnode);
    }
    if (this.attrs && this.attrs.parentPost) {
      this.parentPost = this.attrs.parentPost;
      // Remove from attrs so mithril doesn't render it as
      // `parentpost="[object Object]"` on the composer root
      // element. We delete AFTER copying to be safe in case
      // some downstream code reads `this.attrs.parentPost`.
      delete this.attrs.parentPost;
    }
  });

  // ---- headerItems: change title to "回复 @username" ----
  extend(ReplyComposerClass.prototype, 'headerItems', function (items) {
    const parentPost = this.parentPost;
    if (!parentPost) {
      // No parentPost — vendor default title (discussion title)
      // is fine (this is the discussion-level Reply path).
      return items;
    }

    if (items.has('title')) {
      items.remove('title');
    }

    const parentUser = typeof parentPost.user === 'function' ? parentPost.user() : null;
    const parentUserName = parentUser && parentUser.displayName
      ? parentUser.displayName()
      : `#${parentPost.id()}`;
    const parentDiscussion = typeof parentPost.discussion === 'function'
      ? parentPost.discussion()
      : null;
    const parentDiscussionHref = parentDiscussion
      ? app.route.discussion(parentDiscussion)
      : '#';
    const parentDiscussionTitle = parentDiscussion ? parentDiscussion.title() : '';

    items.add(
      'title',
      <h3>
        <Icon name={'fas fa-reply'} />{' '}
        {app.translator.trans('ziven-post-comment.forum.composer.reply_to', {
          username: parentUserName,
        })}
        {parentDiscussionTitle ? (
          <>
            {' '}
            <Link href={parentDiscussionHref} onclick={(e) => {
              if (app.composer.isFullScreen()) {
                app.composer.minimize();
                e.stopPropagation();
              }
            }}>
              {parentDiscussionTitle}
            </Link>
          </>
        ) : null}
      </h3>,
      100
    );

    return items;
  });

  // ---- data: add parentPost relationship ----
  // Vendor returns `{ content, relationships: { discussion } }`.
  // We add `parentPost` so the API persists `parent_post_id`.
  override(ReplyComposerClass.prototype, 'data', function (original) {
    // 防御性 super-call: vendor data() return { content, relationships: { discussion } }
    const base = original ? original.call(this) : {};
    if (!this.parentPost) {
      return base;
    }
    return {
      ...base,
      relationships: {
        ...(base.relationships || {}),
        parentPost: this.parentPost,
      },
    };
  });

  // ---- onsubmit: refresh parent post's replies list on success ----
  // The vendor onsubmit handles the post stream update + alert
  // on success. We additionally fire a custom event so the
  // NestedReplies component can refresh the in-page list.
  // We dynamically import `appEvents` here (rather than at the
  // top of the file) because `flarum/common/events` is also a
  // webpack chunk that may not have loaded yet at the time the
  // zpc dist's top-level module body runs (SOP 250 / vendor
  // lazy chunk load). Resolving it at submit time — which only
  // happens after the user has clicked a zpc card, by which
  // point the forum chunks are all loaded — sidesteps the
  // chunk-load-order issue.
  override(ReplyComposerClass.prototype, 'onsubmit', function (original) {
    // 防御性 super-call: vendor onsubmit 通常 return undefined, 但保留 result 以防万一
    const result = original ? original.call(this) : undefined;
    const parentPost = this.parentPost;
    if (parentPost) {
      setTimeout(() => {
        const fire = (appEvents) => {
          if (app.store && typeof app.store.find === 'function') {
            // v0.1.0e.f: switched from `?filter[parent]=` to
            // `?filter[ziven-post-comment:replies]=` so the
            // backend's `TopLevelOnlyScope` global Eloquent
            // scope (added in this commit) is explicitly removed
            // before applying the `where('parent_post_id', '=',
            // parentId)` constraint. With the old
            // `?filter[parent]=`, the global `whereNull` ANDs
            // the explicit `= parentId` into an empty set, and
            // the store warmup would no longer prime the
            // `NestedReplies.jsx` `getById('posts', ...)` cache
            // for the children. The new filter returns the
            // actual children. See `RepliesFilter.php`.
            app.store
              .find('posts', {
                filter: { 'ziven-post-comment:replies': parentPost.id() },
                include: 'user',
              })
              .then(() => {
                appEvents.trigger('zpc:nestedReplyPosted', { parentPost });
              })
              .catch(() => {
                appEvents.trigger('zpc:nestedReplyPosted', { parentPost });
              });
          } else {
            appEvents.trigger('zpc:nestedReplyPosted', { parentPost });
          }
        };
        // Dynamic import — flarum/common/events is a chunk.
        import('flarum/common/events')
          .then((mod) => fire(mod.default || mod))
          .catch(() => {
            // If we can't load the events module, the NestedReplies
            // list won't auto-refresh. The user can still see the
            // reply after a page reload.
          });
      }, 0);
    }
    return result;
  });
}

// Apply the extends when the vendor chunk loads. The chunk
// load is triggered by `app.composer.load(ReplyComposer, ...)`
// (webpack dynamic import) — our onLoad callback runs in the
// same microtask, before the first `new ReplyComposer(...)`
// is invoked. We also try a synchronous `flarum.reg.get` in
// case the chunk was already loaded by a prior code path
// (e.g. the user already opened the discussion-level Reply
// composer before clicking a zpc card).
if (typeof flarum !== 'undefined' && flarum.reg) {
  let alreadyLoaded = null;
  try {
    alreadyLoaded = flarum.reg.get('core', 'forum/components/ReplyComposer');
  } catch (e) {
    alreadyLoaded = null;
  }
  if (alreadyLoaded) {
    applyExtends((alreadyLoaded && alreadyLoaded.default) ? alreadyLoaded.default : alreadyLoaded);
  } else {
    flarum.reg.onLoad('core', 'forum/components/ReplyComposer', (mod) => {
      applyExtends((mod && mod.default) ? mod.default : mod);
    });
  }
}

// Re-export as a thunk that triggers the vendor chunk load.
// Vendor's `app.composer.load(t, attrs)` checks if `t` is a
// Component class (has `prototype instanceof Component`). If
// not, it treats `t` as a thunk: `t = (await t()).default`.
// By exporting a thunk, we sidestep two chunk-load-order
// problems at once:
//   1. Our top-level `import ReplyComposer from '...'` is
//      compiled to an async webpack dynamic import. The
//      binding `ReplyComposer` is undefined in the synchronous
//      portion of zpc's top-level module body — re-exporting
//      it would export `undefined`, and `app.composer.load(
//      undefined, attrs)` would fail.
//   2. By the time the thunk actually runs (i.e. when
//      `app.composer.load` awaits it), vendor's chunk is
//      guaranteed loaded AND our `flarum.reg.onLoad` callback
//      has fired AND `applyExtends` has patched the prototype.
//      So the resulting instance is fully zpc-extended.
//
// Callers do
//   app.composer.load(NestedReplyComposer, { parentPost: post })
// which is functionally identical to
//   app.composer.load(vendor ReplyComposer, { parentPost: post })
// — the vendor class is constructed with our extends applied.
export default function NestedReplyComposerLoader() {
  return import('flarum/forum/components/ReplyComposer');
}
