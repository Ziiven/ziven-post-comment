<?php

/*
 * This file is part of ziiven/ziven-post-comment.
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Ziven\PostComment;

use Flarum\Api\Context;
use Flarum\Api\Endpoint;
use Flarum\Api\Resource;
use Flarum\Api\Schema;
use Flarum\Discussion\Discussion;
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
    // v0.1.0e.b design (辉哥拍板 2026-08-19 20:49):
    //   - Posts payload NO LONGER auto-includes `replies` /
    //     `replies.user`. Nested replies are lazy-loaded by the
    //     frontend NestedReplies component (3 default + 10 per
    //     "展示更多" click), so we don't need the entire reply
    //     subtree in the initial Post payload. This shrinks
    //     payloads dramatically — a parent post with 109 nested
    //     replies no longer ships all 109 children + their users
    //     in the main discussion fetch.
    //   - The `replies` / `replies.user` fields are still declared
    //     on PostResource (via PostResourceFields) so the
    //     frontend can `app.store.find('posts', { filter: {
    //     parent: ... }, include: 'user' })` for explicit
    //     pagination later if needed. But they are NOT
    //     default-included anymore.
    (new Extend\ApiResource(Resource\PostResource::class))
        ->fields(PostResourceFields::class)
        ->endpoint(
            [Endpoint\Index::class, Endpoint\Show::class, Endpoint\Create::class, Endpoint\Update::class],
            function (Endpoint\Index|Endpoint\Show|Endpoint\Create|Endpoint\Update $endpoint): Endpoint\Endpoint {
                return $endpoint->addDefaultInclude([
                    'parentPost', 'parentPost.user',
                    // 'replies' / 'replies.user' removed in v0.1.0e.b
                    // (D2 辉哥拍板). Nested replies now lazy-loaded by
                    // NestedReplies.jsx.
                ]);
            }
        ),

    // v0.1.0e.b: override vendor DiscussionResource's `posts`
    // relationship to ONLY return top-level posts (parent_post_id IS
    // NULL). Without this, `discussion.postIds()` returns the full
    // 112 ids (5 主楼 + 107 reply) in mixed order, and the vendor
    // PostStream slices that into a stream of 20 (主楼 + reply
    // interleaved). The 辉哥 20:46 + 20:49 design says the main
    // post stream should show ONLY 主楼; nested replies are a
    // separate UI under each 主楼, lazy-loaded.
    //
    // The `get` callback is the one that vendor defines
    // (DiscussionResource.php:225-229):
    //     return $discussion->posts()
    //         ->whereVisibleTo($context->getActor())
    //         ->select('id')
    //         ->get()
    //         ->all();
    // We override with the same shape but with
    // `->whereNull('parent_post_id')` added. The
    // `Extend\ApiResource::field('posts', ...)` mutator receives
    // the existing field, returns a field with a replaced getter.
    // (SOP 256: vendor discussion posts relationship override
    // pattern; same shape as
    // `addDefaultInclude([...])` used elsewhere.)
    (new Extend\ApiResource(Resource\DiscussionResource::class))
        ->field('posts', function (Schema\Relationship\ToMany $field): Schema\Relationship\ToMany {
            return $field->get(function (Discussion $discussion, Context $context): array {
                return $discussion->posts()
                    ->whereNull('parent_post_id')
                    ->whereVisibleTo($context->getActor())
                    ->select('id')
                    ->get()
                    ->all();
            });
        }),

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
