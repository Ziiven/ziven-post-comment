// Ziven Post Comment — A1 single-level nested replies
//
// Extends the core CommentPost to render a NestedReplies block underneath
// each top-level comment, and add a "Reply" action that opens an inline
// ReplyComposer for the nested reply.

import app from 'flarum/forum/app';
import { extend, override } from 'flarum/common/extend';
import CommentPost from 'flarum/forum/components/CommentPost';
import Button from 'flarum/common/components/Button';
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

  // Add a "Reply" action to each top-level post. The actual inline composer
  // lives inside <NestedReplies> and is toggled by the per-post "Reply"
  // button. v0.1.0d: skip the first post of the discussion for the same
  // reason as `content` above.
  extend(CommentPost.prototype, 'actionItems', function (items) {
    const post = this.attrs.post;

    if (post.isReply() || post.isHidden() || post.number() === 1) {
      return;
    }

    // Need to be logged in AND able to reply to the discussion.
    if (!app.session.user || !post.discussion().canReply()) {
      return;
    }

    items.add(
      'nested-reply',
      <Button
        className="Button Button--link Post-nestedReplyBtn"
        icon="fas fa-reply"
        onclick={() => {
          // Toggle the inline composer inside NestedReplies — scroll to
          // it and focus the textarea. The composer is now hidden by
          // default (v0.1.0d), so this also flips it open via the same
          // event NestedReplies' own "Reply" button uses.
          const $composer = this.$('.NestedReplies-replyBtn')[0];
          if ($composer) $composer.click();
        }}
      >
        {app.translator.trans('ziven-post-comment.forum.post.reply_link')}
      </Button>,
      -20 // place after the core "Reply" link
    );
  });

  // Override the elementAttrs to add `Post--hasReplies` when this post has
  // nested replies, so we can show an indicator (e.g. a left border).
  // v0.1.0d: also skip the first post — the starter post never gets the
  // `Post--hasReplies` accent (it has no NestedReplies block at all).
  override(CommentPost.prototype, 'elementAttrs', function (original) {
    const attrs = original();
    const post = this.attrs.post;
    attrs.className = classList(attrs.className, {
      'Post--hasReplies': !post.isReply() && post.number() !== 1 && post.repliesCount() > 0,
    });
    return attrs;
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
