<?php

/*
 * This file is part of ziiven/ziven-post-comment.
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Ziven\PostComment\Listener;

use Flarum\Notification\NotificationSyncer;
use Flarum\Post\Event\Posted;
use Flarum\Post\Post;
use Ziven\PostComment\Notification\PostCommentedBlueprint;

/**
 * Listen for new posts being created. If the new post is a nested reply
 * (parent_post_id is set on creation), notify the parent post's author.
 *
 * The `Posted` event fires only on post creation (from CommentPost::boot),
 * not on edits or restores, so we don't need an extra "is this a new post?"
 * check here.
 *
 * Inspired by flarum/likes SendNotificationWhenPostIsLiked.
 */
class SendNotificationWhenPostIsReplied
{
    public function __construct(
        protected NotificationSyncer $notifications
    ) {
    }

    public function handle(Posted $event): void
    {
        $post = $event->post;

        // Only act on nested replies (parent_post_id set).
        $parentPostId = $post->parent_post_id;

        if (! $parentPostId) {
            return; // not a nested reply
        }

        /** @var Post|null $parent */
        $parent = Post::query()->find($parentPostId);

        if (! $parent || ! $parent->user) {
            return;
        }

        // A1 single-level: only notify on top-level parents. A reply-of-a-reply
        // is rejected at the API layer (RejectNestedReply listener), so this
        // check is a defense-in-depth in case the API guard is bypassed.
        if ($parent->parent_post_id !== null) {
            return;
        }

        // Don't notify users about their own replies.
        $actor = $event->actor ?? $post->user;
        if (! $actor || $parent->user->id === $actor->id) {
            return;
        }

        $this->notifications->sync(
            new PostCommentedBlueprint($post, $actor),
            [$parent->user]
        );
    }
}
