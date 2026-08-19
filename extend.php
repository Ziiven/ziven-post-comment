<?php

/*
 * This file is part of ziiven/ziven-post-comment.
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Ziven\PostComment;

use Flarum\Api\Endpoint;
use Flarum\Api\Resource;
use Flarum\Extend;
use Flarum\Post\Event\Saving;
use Flarum\Post\Filter\PostSearcher;
use Flarum\Post\Post;
use Flarum\Search\Database\DatabaseSearchDriver;
use Ziven\PostComment\Api\PostResourceFields;
use Ziven\PostComment\Listener\RejectNestedReply;
use Ziven\PostComment\Listener\SendNotificationWhenPostIsReplied;
use Ziven\PostComment\Notification\PostCommentedBlueprint;
use Ziven\PostComment\Provider\MigrationServiceProvider;
use Ziven\PostComment\Query\ParentFilter;
use Ziven\PostComment\Query\ReplyCount;

return [
    // Migration service provider (so `flarum migrate` picks up our migration files)
    (new Extend\ServiceProvider())
        ->register(MigrationServiceProvider::class),

    // Frontend
    (new Extend\Frontend('forum'))
        ->js(__DIR__.'/js/dist/forum.js')
        ->css(__DIR__.'/less/forum.less'),

    // i18n
    new Extend\Locales(__DIR__.'/locale'),

    // Model relations: parent_post_id belongsTo + hasMany replies
    (new Extend\Model(Post::class))
        ->belongsTo('parentPost', Post::class, 'parent_post_id')
        ->hasMany('replies', Post::class, 'parent_post_id'),

    // Add parentPost + repliesCount + isReply fields to PostResource.
    // v0.1.0e.a design (辉哥拍板 2026-08-19 16:24, 撤回 v0.1.0e 的 A2
    // 无限层 include): we include `replies` 1 level deep (plus
    // `replies.user` for the author avatar/name) — single-level
    // nested replies, matching WeChat 朋友圈 / 小黑盒 / 知乎 / 微博
    // UX. v0.1.0e previously included 5 levels deep (each level
    // included its own `replies` + `user`); that produced a
    // quadratic payload bloat for the (rare) deeply-nested case,
    // and the frontend no longer needs it because we don't render
    // nested-of-nested anymore.
    (new Extend\ApiResource(Resource\PostResource::class))
        ->fields(PostResourceFields::class)
        ->endpoint(
            [Endpoint\Index::class, Endpoint\Show::class, Endpoint\Create::class, Endpoint\Update::class],
            function (Endpoint\Index|Endpoint\Show|Endpoint\Create|Endpoint\Update $endpoint): Endpoint\Endpoint {
                return $endpoint->addDefaultInclude([
                    'parentPost', 'parentPost.user',
                    'replies', 'replies.user',
                ]);
            }
        ),

    // Filter: ?filter[parent]=null for top-level, ?filter[parent]=123 for a given post's replies
    (new Extend\SearchDriver(DatabaseSearchDriver::class))
        ->addFilter(PostSearcher::class, ParentFilter::class),

    // Register reply notification
    (new Extend\Notification())
        ->type(PostCommentedBlueprint::class, ['alert']),

    // Register the notification preference so the user can opt in/out of
    // postCommented alerts. Default to true (notify by default).
    (new Extend\User())
        ->registerPreference('notify_postCommented_alert', 'boolval', true),

    // Dispatch notification after a reply post is created.
    // We listen for the `Posted` event (fired only on post creation, not edits).
    (new Extend\Event())
        ->listen(\Flarum\Post\Event\Posted::class, SendNotificationWhenPostIsReplied::class),

    // Reject nested-of-nested replies at the API layer (A1 single-level guard).
    // v0.1.0e.a design (辉哥拍板 2026-08-19 16:24, 撤回 v0.1.0e 的 A2 无限层):
    // re-adds the guard that v0.1.0e removed. API returns 422 if a
    // request tries to set `parentPost` to a post that already has
    // `parent_post_id` set (i.e. trying to reply to a reply).
    (new Extend\Event())
        ->listen(Saving::class, RejectNestedReply::class),

    // Search query support: ?filter[replyCount]=0 (posts with no replies)
    (new Extend\SearchDriver(DatabaseSearchDriver::class))
        ->addFilter(PostSearcher::class, ReplyCount::class),
];
