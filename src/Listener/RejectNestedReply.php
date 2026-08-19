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
 * Reject nested-of-nested replies at the API layer (A1 single-level guard).
 *
 * v0.1.0e.a design (辉哥拍板 2026-08-19 16:24, 撤回 v0.1.0e 的 A2
 * 无限层): the extension is single-level (1 层) — a top-level post
 * can be replied to, but a reply cannot itself be replied to. The
 * frontend's NestedReplies is only rendered on top-level posts, so
 * under normal use this is enforced client-side. This listener is
 * the server-side guard for direct API calls (curl, third-party
 * clients, future UI changes) and for any other code path that
 * might set `parentPost` on a new post.
 *
 * Modelled after flarum/approval's ApproveContent listener pattern.
 * Originally added in v0.1.0a (commit 35b2d1a, P1 nested reply
 * reject), removed in v0.1.0e (commit 58a99ae, A2 无限层), re-added
 * in v0.1.0e.a.
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
