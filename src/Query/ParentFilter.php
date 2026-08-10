<?php

/*
 * This file is part of ziven/ziven-post-comment.
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Ziven\PostComment\Query;

use Flarum\Search\Database\DatabaseSearchState;
use Flarum\Search\Filter\FilterInterface;
use Flarum\Search\SearchState;
use Flarum\Search\ValidateFilterTrait;

/**
 * Filter posts by their parent.
 *
 * Usage:
 *   ?filter[parent]=null  -> top-level comments (parent_post_id IS NULL)
 *   ?filter[parent]=123   -> replies to post #123
 *   ?filter[parent]=-456  -> the single post whose id is 456 (negated; same as 456)
 *
 * Modelled after flarum/likes LikedByFilter.
 *
 * @implements FilterInterface<DatabaseSearchState>
 */
class ParentFilter implements FilterInterface
{
    use ValidateFilterTrait;

    public function getFilterKey(): string
    {
        return 'parent';
    }

    public function filter(SearchState $state, string|array $value, bool $negate): void
    {
        $raw = $this->asString($value);

        // null / 'null' / empty -> top-level posts
        if ($raw === '' || strtolower($raw) === 'null') {
            $state->getQuery()->whereNull('posts.parent_post_id', $negate ? 'and' : 'and', $negate);

            return;
        }

        $parentId = intval($raw);

        if ($negate) {
            $state->getQuery()->where('posts.parent_post_id', '!=', $parentId);
        } else {
            $state->getQuery()->where('posts.parent_post_id', '=', $parentId);
        }
    }
}
