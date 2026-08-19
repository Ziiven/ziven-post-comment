// Ziven Post Comment — infinite-nesting nested replies (仿小黑盒)
//
// v0.1.0e redesign (辉哥拍板 2026-08-19 14:35):
//   - A2: replies are now infinite-nesting (a reply of a reply can
//     itself be replied to, and so on). The previous A1 single-level
//     guard (RejectNestedReply listener + addDefaultInclude
//     "replies" only) is removed.
//   - B1: the entire main-post card (CommentPost) is clickable to
//     open the inline reply composer (a 小黑盒-style "click
//     anywhere on the card to reply" UX). The vendor-supplied
//     "Reply" link/button on the post is preserved (C1) and still
//     uses vendor semantics for its reply flow.
//   - C1: vendor's "Reply" link/button is preserved unchanged.
//     Users can either click anywhere on the card OR use the
//     vendor "Reply" button to enter the global reply flow.
//   - D1: nested layers keep the v0.1.0d defaults (3 visible,
//     "View N more" for the rest, no auto-load).
//
// Implementation: a native `click` listener on the CommentPost
// `<article>` (SOP 207 / 208 — vendor Flarum 2.0's
// SubtreeRetainer blocks mithril JSX `onclick` re-binding, so we
// bind a native listener once in `oncreate` and rely on the DOM
// node being stable until the parent re-renders the post list).
// The listener excludes: anchors (let browser navigate), vendor
// Post-actions (like / vendor reply), child NestedReplies /
// NestedReply elements (each has its own card-click handler),
// and the composer itself (let it handle its own input).

import app from 'flarum/forum/app';
import { extend, override } from 'flarum/common/extend';
import CommentPost from 'flarum/forum/components/CommentPost';
import classList from 'flarum/common/utils/classList';

import NestedReplies from './components/NestedReplies';

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

  // v0.1.0e: removed the extension-defined "Reply" action on the
  // CommentPost's actionItems (the old
  // `items.add('nested-reply', <Button ...>)` block). The card is
  // now clickable as a whole, and the vendor "Reply" link is
  // preserved (C1). Removing the extension's "Reply" action avoids
  // two redundant entry points into the same composer.

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

  // v0.1.0e: bind a native `click` listener on the CommentPost
  // `<article>` to implement "click anywhere on the card to reply"
  // (B1 in the v0.1.0e spec). The vendor-supplied "Reply" button
  // is preserved (C1) and uses vendor semantics — this listener
  // is the *additional* entry point into the same inline composer.
  // The listener is bound natively (not via mithril JSX `onclick`)
  // because vendor Flarum 2.0's `SubtreeRetainer` blocks
  // CommentPost subtree re-renders, which would orphan any
  // mithril-attached click handler. SOP 207 / 208 pattern.
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

      // Exclusion list (any match → bail out and let the
      // click reach whatever is underneath):
      //
      // 1. Links — username / time / vendor action links must
      //    still navigate.
      if (t.closest && t.closest('a[href]')) return;

      // 2. Vendor Post-actions (Like button, vendor Reply
      //    button, etc.) — vendor has its own click semantics.
      if (t.closest && t.closest('.Post-actions')) return;

      // 3. NestedReplies / NestedReply children — each has its
      //    own card-click handler (NestedReply.bindCardClick).
      //    The child handler calls `stopPropagation()`, so this
      //    is defensive, but it's the correct layering.
      if (t.closest && t.closest('.NestedReplies, .NestedReply, .NestedReply-replies')) return;

      // 4. The composer itself (if the user is typing in the
      //    textarea) — let the composer handle its own clicks.
      if (t.closest && t.closest('.NestedReplies-composer, .ReplyComposer')) return;

      // ---- Open the composer on the post's NestedReplies ----
      const nested = article.querySelector('.Post-nestedReplies .NestedReplies');
      if (!nested) return;
      const inst = nested.__zpcNestedReplies;
      if (inst && typeof inst.toggleComposer === 'function') {
        inst.toggleComposer();
        e.stopPropagation();
      }
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
