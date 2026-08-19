// NestedReplyComposer — vendor Flarum 2.0 reply composer extended to
// support a `parentPost` field (the post being replied to).
//
// v0.1.0e.a design (辉哥拍板 2026-08-19 16:24):
//   - Use the **vendor Flarum 2.0 composer** (走 `app.composer.load(...
//     ReplyComposer, ...)` 弹全局 composer 浮层) — NOT a zpc inline
//     textarea composer.
//   - Vendor `flarum/forum/components/ReplyComposer` is a
//     *Discussion-level* composer (its `data()` returns
//     `relationships: { discussion }`). It does not natively support
//     a `parentPost` field — replying to a specific post (a
//     nested reply) is a zpc-specific concept.
//   - We extend the vendor ReplyComposer and override only:
//       * `static initAttrs(attrs)` — pull `parentPost` out of the
//         attrs so mithril doesn't pass it down to DOM attributes
//         and to provide a parentPost-aware placeholder / submit
//         label / confirmExit copy if we want to localize them later.
//       * `data()` — add `relationships.parentPost` to the data
//         sent to `/api/posts`, while still sending `discussion`
//         (the API requires both: discussion is the parent
//         relationship, parent_post_id is the column we add to point
//         at the specific post inside that discussion).
//       * `headerItems()` — change the title from "讨论标题" to
//         "回复 @username" so the user knows which post they're
//         replying to (vendor default is just the discussion title,
//         which doesn't make sense for nested replies).
//   - All other behavior — composer body rendering, validation,
//     "view post" alert on success, etc. — is inherited verbatim
//     from the vendor class. This is the cleanest way to get
//     "vendor composer弹层" UX + "parentPost relationship" semantics
//     without duplicating vendor logic.
//
// Why a separate file (instead of overriding vendor in place)?
//   - We must NOT modify vendor files (SOP, also Flarum extension
//     rule).
//   - Inheriting from vendor in our own subclass is the
//     standard Flarum extension pattern (e.g. `class MyComposer
//     extends ComposerBody` is how custom composers are built in
//     the Flarum ecosystem).
//   - The file is named `NestedReplyComposer` (not
//     `NestedReplyComposer.jsx`) because it does not use JSX
//     syntax — it just overrides methods on the vendor class. This
//     matches vendor's own `ReplyComposer.js` (no JSX).
//
// Trigger path (整张卡片 click):
//   - `js/src/forum/index.js` — CommentPost card-click handler
//     calls `app.composer.load(NestedReplyComposer, { parentPost })`
//     when the user clicks the main-post card body.
//   - `js/src/forum/components/NestedReply.jsx` — NestedReply
//     card-click handler calls
//     `app.composer.load(NestedReplyComposer, { parentPost: reply })`
//     when the user clicks a NestedReply card.
//
// Note: we do NOT keep a zpc-specific visible composer anywhere —
// the user always sees the vendor composer 弹层 (which is the
// 辉哥 requirement: "用 Flarum 原生 composer, 不是 zpc 自加的
// inline composer"). When the vendor composer posts a new reply,
// the in-page nested-replies list is refreshed via
// `app.store.find('posts', { filter: { parent } })` from the
// caller's onsuccess callback (see index.js / NestedReply.jsx).

import app from 'flarum/forum/app';
import appEvents from 'flarum/common/events';
import ReplyComposer from 'flarum/forum/components/ReplyComposer';
import Link from 'flarum/common/components/Link';
import Icon from 'flarum/common/components/Icon';

export default class NestedReplyComposer extends ReplyComposer {
  static initAttrs(attrs) {
    super.initAttrs(attrs);

    // Pull the parent post out of attrs so the rest of the
    // attrs tree (placeholder, submitLabel, etc.) doesn't carry it
    // down to DOM. We save a reference on the instance via
    // `this.parentPost` in `oninit` (see below).
    this._parentPost = attrs.parentPost || null;
  }

  oninit(vnode) {
    super.oninit(vnode);
    // Mirror the static-init capture onto the instance. The static
    // method doesn't get `this`, so we save it on the prototype-level
    // `this._parentPost` from initAttrs and then copy it onto the
    // instance here.
    this.parentPost = this._parentPost || null;
  }

  /**
   * Override vendor `headerItems()` so the composer title shows
   * "回复 @username" instead of the discussion title. The user
   * needs to know *which* post they're replying to in a nested
   * context — the discussion title alone is not informative.
   */
  headerItems() {
    const items = super.headerItems();

    // Remove the default 'title' item (the one that shows the
    // discussion title) and replace it with a parentPost-aware
    // title. We use `remove()` rather than just adding a new one
    // (SOP 254 — `items.remove` > wrap div / duplicate).
    if (items.has('title')) {
      items.remove('title');
    }

    const parentPost = this.parentPost;
    const parentUser = parentPost && typeof parentPost.user === 'function'
      ? parentPost.user()
      : null;
    const parentUserName = parentUser && parentUser.displayName
      ? parentUser.displayName()
      : (parentPost ? `#${parentPost.id()}` : '');
    const parentHref = parentPost ? app.route.post(parentPost) : '#';
    const parentDiscussion = parentPost && typeof parentPost.discussion === 'function'
      ? parentPost.discussion()
      : null;
    const parentDiscussionHref = parentDiscussion
      ? app.route.discussion(parentDiscussion)
      : '#';
    const parentDiscussionTitle = parentDiscussion
      ? parentDiscussion.title()
      : '';

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
              // Match vendor behavior: minimize composer on
              // full-screen before navigating.
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
      // Place above any 'username' / 'meta' items so the title is
      // always the first thing the user sees.
      100
    );

    return items;
  }

  /**
   * Override vendor `data()` to add the `parentPost` relationship
   * alongside `discussion`. The vendor returns:
   *
   *   { content, relationships: { discussion: this.attrs.discussion } }
   *
   * We need to add `parentPost` to the relationships so the API
   * persists `parent_post_id` on the new post row. The `discussion`
   * is still required (it's the discussion the new post belongs to;
   * `parent_post_id` is just an extra column pointing at the
   * specific post within the discussion).
   */
  data() {
    const base = super.data();
    const parentPost = this.parentPost;
    if (!parentPost) {
      return base;
    }
    return {
      ...base,
      relationships: {
        ...(base.relationships || {}),
        parentPost,
      },
    };
  }

  /**
   * Override `onsubmit` to refresh the in-page nested-replies list
   * after a successful reply post. Vendor's default is fine for
   * top-level discussion replies (it updates the post stream), but
   * for a nested reply, the post stream may not need updating
   * (the new post is not part of the main stream) — what DOES
   * need to happen is a refresh of the parent post's replies
   * list, so the new reply shows up under the right post.
   *
   * Strategy: keep the vendor success path (alerts, post stream
   * update, view button) AND fire a custom event so the
   * NestedReplies component can refresh its list. We dispatch
   * a `appEvents` event ('zpc:nestedReplyPosted') that the
   * index.js / NestedReply.jsx callers can listen for.
   */
  onsubmit() {
    const parentPost = this.parentPost;
    const result = super.onsubmit();

    // The vendor's onsubmit returns a Promise from .save(). We
    // attach a `.then` to fire our custom event after a
    // successful save, regardless of the result the vendor
    // returns. (vendor uses .then(success, this.loaded.bind)
    // internally, so we hook in via the public save result
    // instead.)
    if (parentPost && app.store && typeof app.store.find === 'function') {
      // The vendor code already kicks off a post stream update
      // (if `app.viewingDiscussion(discussion)`). We additionally
      // fetch the new replies list for this parent post so the
      // in-page NestedReplies component can re-render the new
      // reply. We fire a custom event for the component to
      // listen for, so this composer doesn't need to know about
      // DOM internals.
      setTimeout(() => {
        app.store
          .find('posts', {
            filter: { parent: parentPost.id() },
            include: 'user',
          })
          .then(() => {
            appEvents.trigger('zpc:nestedReplyPosted', { parentPost });
          })
          .catch(() => {
            // Silent — if the refresh fails, the user can
            // still see the reply after a page reload.
          });
      }, 0);
    }

    return result;
  }
}
