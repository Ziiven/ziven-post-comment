<?php

/*
 * This file is part of ziven/ziven-post-comment.
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Ziven\PostComment\Notification;

use Flarum\Database\AbstractModel;
use Flarum\Notification\AlertableInterface;
use Flarum\Notification\Blueprint\BlueprintInterface;
use Flarum\Post\Post;
use Flarum\User\User;

/**
 * Notification sent to the author of a parent post when somebody replies to
 * it. Modelled after flarum/likes PostLikedBlueprint.
 *
 * The subject is the *reply* post (not the parent), so the notification list
 * links the user directly to the new reply.
 */
class PostCommentedBlueprint implements BlueprintInterface, AlertableInterface
{
    public function __construct(
        public Post $reply,
        public User $actor
    ) {
    }

    public function getSubject(): ?AbstractModel
    {
        return $this->reply;
    }

    public function getFromUser(): ?User
    {
        return $this->actor;
    }

    /**
     * Custom data for the notification payload. We include the parent post id
     * so the frontend can build a "in reply to your post" preview without an
     * extra API round-trip.
     */
    public function getData(): mixed
    {
        return [
            'parentPostId' => $this->reply->parent_post_id,
        ];
    }

    public static function getType(): string
    {
        return 'postCommented';
    }

    public static function getSubjectModel(): string
    {
        return Post::class;
    }
}
