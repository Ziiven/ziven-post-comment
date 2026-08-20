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
use Ziven\PostComment\Provider\PostModelScopeProvider;
use Ziven\PostComment\Query\ParentFilter;
use Ziven\PostComment\Query\RepliesFilter;
use Ziven\PostComment\Query\ReplyCount;

return [
    // Migration service provider (so `flarum migrate` picks up our migration files)
    (new Extend\ServiceProvider())
        ->register(MigrationServiceProvider::class),

    // v0.1.0e.f: attach zpc `TopLevelOnlyScope` global Eloquent
    // scope to the `Post` model. After this runs, every Post
    // query (including the vendor PostIndex endpoint's) is
    // automatically constrained to `parent_post_id IS NULL`
    // (top-level / 主楼). Callers that want to bypass the
    // scope (e.g. zpc's `NestedReplies.jsx` fetching the
    // children of a parent post) must use the dedicated
    // `?filter[ziven-post-comment:replies]=N` filter (registered
    // below) which calls `withoutGlobalScope()`.
    //
    // The provider runs after vendor `Post::booted()` (which
    // attaches `RegisteredTypesScope`), so both scopes compose
    // with AND: vendor type filter + zpc top-level filter.
    (new Extend\ServiceProvider())
        ->register(PostModelScopeProvider::class),

    // Frontend
    (new Extend\Frontend('forum'))
        ->js(__DIR__.'/js/dist/forum.js')
        ->css(__DIR__.'/less/forum.less'),

    // i18n
    new Extend\Locales(__DIR__.'/locale'),

    // Model relations: parent_post_id belongsTo + hasMany replies
    //
    // v0.1.0e.f: the `replies` relationship must bypass the
    // `TopLevelOnlyScope` global Eloquent scope, otherwise
    // `countRelation('replies')` in PostResourceFields returns
    // 0 for every post (the vanilla `hasMany(Post::class,
    // 'parent_post_id')` composes with the global `whereNull` into
    // `parent_post_id = X AND parent_post_id IS NULL`, which is
    // always empty). The frontend reads `repliesCount` to decide
    // whether to render the "展示更多" button under a 主楼
    // (and to render the NestedReplies container at all). A
    // zero count would silently hide every 主楼's nested replies.
    //
    // We use `Extend\Model::relationship` with a closure (instead
    // of the convenience `->hasMany(...)`) so we can chain
    // `->withoutGlobalScope(TopLevelOnlyScope::class)` on the
    // resulting HasMany relation. Laravel's `Relation::__call`
    // forwards the call to the underlying Eloquent Builder, so
    // the global scope is correctly removed for any query that
    // traverses this relationship (count, get, paginate, etc.).
    //
    // This is consistent with `RepliesFilter::filter()` which
    // also calls `withoutGlobalScope(TopLevelOnlyScope::class)`
    // on the search-state query.
    (new Extend\Model(Post::class))
        ->belongsTo('parentPost', Post::class, 'parent_post_id')
        ->relationship('replies', function (Post $post) {
            return $post->hasMany(Post::class, 'parent_post_id')
                ->withoutGlobalScope(\Ziven\PostComment\Query\TopLevelOnlyScope::class);
        }),

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

    // v0.1.0e.f: RepliesFilter — zpc's way to fetch the nested
    // REPLIES of a parent post. The existing `ParentFilter`
    // (`?filter[parent]=N`) composes with the new
    // `TopLevelOnlyScope` global scope into
    // `parent_post_id IS NULL AND parent_post_id = N` — that
    // intentionally returns zero rows. `RepliesFilter` uses a
    // different filter key (`ziven-post-comment:replies`) and
    // explicitly removes the `TopLevelOnlyScope` before applying
    // the `where('parent_post_id', '=', N)` constraint, so the
    // SQL becomes `parent_post_id = N` and the children of
    // post N are returned. Used by `NestedReplies.jsx` for the
    // 3-default + 10-load-more lazy load.
    (new Extend\SearchDriver(DatabaseSearchDriver::class))
        ->addFilter(PostSearcher::class, RepliesFilter::class),

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
