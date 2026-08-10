<?php

/*
 * This file is part of ziiven/ziven-post-comment.
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Ziven\PostComment\Listener;

use Flarum\Foundation\ValidationException;
use Flarum\Post\Event\Saving;
use Flarum\Post\Post;
use Illuminate\Support\Arr;

/**
 * Reject nested-of-nested replies at the API layer.
 *
 * The extension is "A1 single-level" (楼中楼 flat one-layer): a top-level
 * post can be replied to, but a reply cannot itself be replied to. The
 * frontend's ReplyComposer is only rendered on top-level posts, so under
 * normal use this is enforced client-side. This listener is the
 * server-side guard for direct API calls (curl, third-party clients,
 * future UI changes).
 *
 * Modelled after flarum/approval's ApproveContent listener pattern.
 */
class RejectNestedReply
{
    /**
     * @throws ValidationException
     */
    public function handle(Saving $event): void
    {
        $parentId = Arr::get($event->data, 'relationships.parentPost.data.id');

        if (! $parentId) {
            return; // top-level post, nothing to validate
        }

        /** @var Post|null $parent */
        $parent = Post::query()->find($parentId);

        if (! $parent) {
            // Let the core validation handle missing parents — we only
            // care about the nested-of-nested case.
            return;
        }

        if ($parent->parent_post_id !== null) {
            throw new ValidationException([
                'parentPost' => 'Cannot reply to a reply (single-level only)',
            ]);
        }
    }
}
