<?php

/*
 * This file is part of ziiven/ziven-post-comment.
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Ziven\PostComment\Api;

use Flarum\Api\Schema;
use Flarum\Post\Post;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Exposes the nested-reply fields on the Post JSON:API resource:
 *   - isReply:        true if this post has a parent_post_id
 *   - parentPost:     ToOne relationship to the parent Post
 *   - repliesCount:   number of nested replies (auto via ->countRelation)
 *   - replies:        ToMany relationship to the nested replies
 *
 * Inspired by flarum/likes src/Api/PostResourceFields — uses the Flarum 2.0
 * jsonapi-server Schema/Field API rather than the legacy Serializer pattern.
 */
class PostResourceFields
{
    public function __invoke(): array
    {
        return [
            Schema\Boolean::make('isReply')
                ->get(function (Post $post): bool {
                    return $post->parent_post_id !== null;
                }),

            Schema\Integer::make('repliesCount')
                ->countRelation('replies'),

            Schema\Relationship\ToOne::make('parentPost')
                ->type('posts')
                ->includable()
                ->writableOnCreate(),

            Schema\Relationship\ToMany::make('replies')
                ->type('posts')
                ->includable()
                ->scope(function (HasMany $query) {
                    $query->orderBy('created_at', 'asc');
                }),
        ];
    }
}
