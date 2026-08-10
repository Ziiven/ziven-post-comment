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

    // Add parentPost + repliesCount + isReply fields to PostResource
    (new Extend\ApiResource(Resource\PostResource::class))
        ->fields(PostResourceFields::class)
        ->endpoint(
            [Endpoint\Index::class, Endpoint\Show::class, Endpoint\Create::class, Endpoint\Update::class],
            function (Endpoint\Index|Endpoint\Show|Endpoint\Create|Endpoint\Update $endpoint): Endpoint\Endpoint {
                return $endpoint->addDefaultInclude(['parentPost', 'parentPost.user', 'replies']);
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
    (new Extend\Event())
        ->listen(Saving::class, RejectNestedReply::class),

    // Search query support: ?filter[replyCount]=0 (posts with no replies)
    (new Extend\SearchDriver(DatabaseSearchDriver::class))
        ->addFilter(PostSearcher::class, ReplyCount::class),
];
