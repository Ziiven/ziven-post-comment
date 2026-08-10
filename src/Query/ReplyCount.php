<?php

/*
 * This file is part of ziiven/ziven-post-comment.
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
 * Filter posts by their reply (replies_count) count.
 *
 * Usage:
 *   ?filter[replyCount]=0    -> posts with no nested replies
 *   ?filter[replyCount]=3    -> posts with exactly 3 nested replies
 *   ?filter[replyCount]=>5   -> posts with more than 5 nested replies
 *
 * Supports the operators expected by Flarum's search filter language.
 *
 * @implements FilterInterface<DatabaseSearchState>
 */
class ReplyCount implements FilterInterface
{
    use ValidateFilterTrait;

    public function getFilterKey(): string
    {
        return 'replyCount';
    }

    public function filter(SearchState $state, string|array $value, bool $negate): void
    {
        $raw = $this->asString($value);

        // Allow ">5" / "<3" / ">=2" / "<=10" syntax in the URL value
        if (preg_match('/^\s*(>=|<=|>|<|=)\s*(\d+)\s*$/', $raw, $m)) {
            $op = $m[1];
            $num = (int) $m[2];
            if ($negate) {
                $op = ['>' => '<=', '<' => '>=', '>=' => '<', '<=' => '>', '=' => '!='][$op];
            }
            $state->getQuery()->where('posts.replies_count', $op, $num);

            return;
        }

        $num = intval($raw);
        $state->getQuery()->where('posts.replies_count', $negate ? '!=' : '=', $num);
    }
}
