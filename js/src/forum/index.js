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
  override(CommentPost.prototype, 'content', function (original) {
    const post = this.attrs.post;
    const children = original();

    // Top-level posts only: append the NestedReplies block after the main
    // post body. Reply posts themselves are leaf nodes and don't get a
    // nested-replies section of their own.
    if (post.isReply()) {
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
  // lives inside <NestedReplies> (it's always rendered, no toggle needed —
  // user just types in the textarea under the reply list).
  extend(CommentPost.prototype, 'actionItems', function (items) {
    const post = this.attrs.post;

    if (post.isReply() || post.isHidden()) {
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
          // Scroll to the inline composer inside NestedReplies.
          const el = this.$('.ReplyComposer-input')[0];
          if (el) el.focus();
        }}
      >
        {app.translator.trans('ziven-post-comment.forum.post.reply_link')}
      </Button>,
      -20 // place after the core "Reply" link
    );
  });

  // Override the elementAttrs to add `Post--hasReplies` when this post has
  // nested replies, so we can show an indicator (e.g. a left border).
  override(CommentPost.prototype, 'elementAttrs', function (original) {
    const attrs = original();
    const post = this.attrs.post;
    attrs.className = classList(attrs.className, {
      'Post--hasReplies': !post.isReply() && post.repliesCount() > 0,
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
