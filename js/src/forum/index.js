// Ziven Post Comment — single-level nested replies with vendor Flarum 2.0
// composer for replying.
//
// v0.1.0e.a redesign (辉哥拍板 2026-08-19 16:24, 撤回 v0.1.0e 的 A2 无限层):
//   - 单层: only top-level posts host a NestedReplies block.
//     NestedReplies themselves are leaf nodes. (WeChat 朋友圈 /
//     小黑盒 / 知乎 / 微博 all use 1-level nested replies.)
//   - B1 整张可点击: the entire main-post card (CommentPost) is
//     clickable to open the vendor Flarum 2.0 composer (走
//     `app.composer.load(NestedReplyComposer, { parentPost })`).
//     This is the 辉哥 "用 Flarum 原生 composer" requirement —
//     NOT a zpc inline composer.
//   - B2 更严: the click now ignores `.Post-header` (the entire
//     vendor header area — username / time / avatar / role badge),
//     in addition to the previous `.Post-actions`, links, and
//     `.NestedReplies` / `.NestedReply` children. The user must
//     click `.Post-body` (the post body) to trigger the reply
//     composer.
//   - C1 保留: NestedReply 整张可点击, 也走 vendor composer.
//   - D 单层后端守卫: 恢复 `RejectNestedReply` listener
//     (单层守卫, 跟 v0.1.0d 一致) — API 拒绝创建"回复的
//     回复". addDefaultInclude 改回 1 层 include.

import app from 'flarum/forum/app';
import { extend, override } from 'flarum/common/extend';
import CommentPost from 'flarum/forum/components/CommentPost';
import classList from 'flarum/common/utils/classList';

import NestedReplies from './components/NestedReplies';
import NestedReplyComposer from './components/NestedReplyComposer';

// Make `app.store`'s Post model understand the new fields. Without this the
// frontend will not know about `parentPost()`, `repliesCount()`, or `isReply()`
// (the existing Post model only has discussion / user / etc.).
import Post from 'flarum/common/models/Post';

app.initializers.add('ziven-post-comment', () => {
  // ---- Model extension ---------------------------------------------------
  // `parentPost` and `replies` are ToOne/ToMany relationships; the field
  // helpers produce the correct `parentPost()` / `replies()` accessors.
  Post.prototype.parentPost = function () {
    return this.data.attributes.parentPost
      ? app.store.getById('posts', this.data.attributes.parentPost)
      : null;
  };
  Post.prototype.replies = function () {
    return (this.data.relationships?.replies?.data || []).map((r) => app.store.getById('posts', r.id)).filter(Boolean);
  };
  Post.prototype.repliesCount = function () {
    return this.data.attributes.repliesCount ?? 0;
  };
  Post.prototype.isReply = function () {
    return !!this.data.attributes.isReply;
  };

  // ---- CommentPost extension --------------------------------------------
  // Render the NestedReplies block under each top-level comment.
  // We use `override` here because `content()` returns a Mithril.Children[]
  // array (not an ItemList), so the `extend(pattern)` mutator doesn't fit.
  //
  // v0.1.0d (辉哥亲测发现): the first post of a discussion (number=1) must
  // NOT have a NestedReplies block. The first post IS the discussion
  // starter, and stuffing a "Reply" / composer area underneath it is
  // confusing — every "View N more" / composer / "Reply" affordance the
  // extension adds belongs to *replies* of a post, but a discussion
  // starter is a one-of-a-kind seed post whose only "reply" path is the
  // global discussion composer (not this extension's per-post composer).
  // Skipping number=1 here is also a defensive guard in case the backend
  // ever starts returning first posts with `isReply=false` but `parent
  // != null` (a likely future refactor).
  override(CommentPost.prototype, 'content', function (original) {
    const post = this.attrs.post;
    const children = original();

    // Top-level posts only, and never the first post of a discussion.
    // Reply posts themselves are leaf nodes; the discussion starter is
    // the "root" — neither gets a NestedReplies block.
    if (post.isReply() || post.number() === 1) {
      return children;
    }

    children.push(
      <div className="Post-nestedReplies">
        <NestedReplies post={post} />
      </div>
    );
    return children;
  });

  // Override the elementAttrs to add `Post--hasReplies` when this post has
  // nested replies, so we can show an indicator (e.g. a left border).
  // v0.1.0d: also skip the first post — the starter post never gets the
  // `Post--hasReplies` accent (it has no NestedReplies block at all).
  // v0.1.0e: also add `Post--nestedClickable` for any post that can
  // host a NestedReplies (i.e. is not a reply, is not the first
  // post), so the CSS can attach the cursor:pointer / hover effect
  // precisely where the card-click handler will fire.
  override(CommentPost.prototype, 'elementAttrs', function (original) {
    const attrs = original();
    const post = this.attrs.post;
    const canHostNested = !post.isReply() && post.number() !== 1;
    attrs.className = classList(attrs.className, {
      'Post--hasReplies': canHostNested && post.repliesCount() > 0,
      'Post--nestedClickable': canHostNested,
    });
    return attrs;
  });

  // v0.1.0e.a: bind a native `click` listener on the CommentPost
  // `<article>` to implement "click the post body to reply" (B1
  // 辉哥). The click now opens the **vendor Flarum 2.0
  // composer** (via NestedReplyComposer) — NOT a zpc inline
  // composer. The vendor "Reply" button on the post (if any) is
  // preserved (C1) and uses vendor semantics — this listener
  // is the *additional* entry point into the same vendor
  // composer.
  //
  // The listener is bound natively (not via mithril JSX
  // `onclick`) because vendor Flarum 2.0's `SubtreeRetainer`
  // blocks CommentPost subtree re-renders, which would orphan
  // any mithril-attached click handler. SOP 207 / 208 pattern.
  override(CommentPost.prototype, 'oncreate', function (original, vnode) {
    original(vnode);

    const post = this.attrs.post;
    // Only bind on top-level, non-first posts — these are the
    // ones that actually host a NestedReplies block.
    if (post.isReply() || post.number() === 1) {
      return;
    }

    const article = vnode.dom;
    if (!article || article.dataset.zpcCardClickBound) return;
    article.dataset.zpcCardClickBound = '1';

    const handler = (e) => {
      if (!e || !e.target) return;
      const t = e.target;

      // Exclusion list (B2 辉哥 task, v0.1.0e.a):
      //
      // 1. Links — username / time / vendor action links must
      //    still navigate.
      if (t.closest && t.closest('a[href]')) return;

      // 2. Vendor Post-actions (Like button, vendor Reply
      //    button, etc.) — vendor has its own click semantics.
      if (t.closest && t.closest('.Post-actions')) return;

      // 3. Vendor Post-header (B2 NEW) — the entire vendor
      //    header area (username link, time link, avatar,
      //    role badge) is a navigation area, not a "click to
      //    reply" affordance. The user must click `.Post-body`
      //    to trigger the reply composer.
      if (t.closest && t.closest('.Post-header')) return;

      // 4. NestedReplies / NestedReply children — each has
      //    its own card-click handler (NestedReply.jsx
      //    `_handleCardClick`). The child handler calls
      //    `stopPropagation()`, so this is defensive, but
      //    it's the correct layering.
      if (t.closest && t.closest('.NestedReplies, .NestedReply, .NestedReply-replies')) return;

      // ---- Open the vendor composer ----
      // Defensive: user must be logged in AND have reply
      // permission.
      if (!app.session.user || !post.discussion() || !post.discussion().canReply()) {
        return;
      }

      e.stopPropagation();
      e.preventDefault();

      // Trigger the vendor Flarum 2.0 composer (via our
      // NestedReplyComposer subclass). This is the same
      // composer experience as the discussion-level Reply,
      // but with `parentPost` set to this top-level post —
      // so the new reply is linked back to it via
      // `parent_post_id`.
      app.composer.load(NestedReplyComposer, { parentPost: post });
    };

    article.addEventListener('click', handler);

    // Stash the handler on the instance so the overridden
    // `onremove` (below) can detach it cleanly.
    this._zpcCardClickHandler = handler;
  });

  // Mirror `oncreate` with `onremove` to detach the native
  // listener when the CommentPost is removed from the DOM
  // (e.g. after a post merge / split or a full discussion
  // re-fetch). Without this, removed CommentPosts would still
  // hold a closure reference, leaking memory.
  override(CommentPost.prototype, 'onremove', function (original, vnode) {
    if (this._zpcCardClickHandler && vnode && vnode.dom) {
      vnode.dom.removeEventListener('click', this._zpcCardClickHandler);
      delete vnode.dom.dataset.zpcCardClickBound;
      this._zpcCardClickHandler = null;
    }
    original(vnode);
  });

  // ---- Notification grid -------------------------------------------------
  // Allow users to opt out of the postCommented notification.
  extend('flarum/forum/components/NotificationGrid', 'notificationTypes', function (items) {
    items.add('postCommented', {
      name: 'postCommented',
      icon: 'fas fa-comment',
      label: app.translator.trans('ziven-post-comment.forum.settings.notify_post_commented_label'),
    });
  });
});
