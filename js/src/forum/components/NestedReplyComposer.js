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
import { extend } from 'flarum/common/extend';
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

  // ---- initAttrs: strip parentPost before attrs reach DOM ----
  // The vendor `initAttrs` (inherited from ComposerBody) spreads
  // `attrs` into the root mithril vnode's `attrs`, which mithril
  // then turns into HTML attributes. We extract `parentPost`
  // first so it doesn't end up as
  // `parentpost="[object Object]"` on the composer root element.
  // We stash it on a non-enumerable `__zpcParentPost` property
  // on the returned attrs object; `oninit` (below) copies it to
  // `this.parentPost` and deletes the marker.
  extend(ReplyComposerClass.prototype, 'initAttrs', function (original, attrs) {
    if (attrs && 'parentPost' in attrs) {
      const parentPost = attrs.parentPost;
      delete attrs.parentPost;
      const result = original(attrs);
      if (result) {
        Object.defineProperty(result, '__zpcParentPost', {
          value: parentPost,
          enumerable: false,
          configurable: true,
          writable: true,
        });
      }
      return result;
    }
    return original(attrs);
  });

  // ---- oninit: copy parentPost from attrs to instance ----
  extend(ReplyComposerClass.prototype, 'oninit', function (original, vnode) {
    const result = original(vnode);
    if (this.attrs && this.attrs.__zpcParentPost) {
      this.parentPost = this.attrs.__zpcParentPost;
      delete this.attrs.__zpcParentPost;
    }
    return result;
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
  extend(ReplyComposerClass.prototype, 'data', function (original) {
    const base = original();
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
  extend(ReplyComposerClass.prototype, 'onsubmit', function (original) {
    const result = original();
    const parentPost = this.parentPost;
    if (parentPost) {
      setTimeout(() => {
        const fire = (appEvents) => {
          if (app.store && typeof app.store.find === 'function') {
            app.store
              .find('posts', {
                filter: { parent: parentPost.id() },
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

// Re-export the vendor class. Callers do
//   app.composer.load(NestedReplyComposer, { parentPost: post })
// which is functionally identical to
//   app.composer.load(vendor ReplyComposer, { parentPost: post })
// — same class, our extends already applied via the onLoad
// hook above.
export default ReplyComposer;
