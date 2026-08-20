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
 * Filter posts to return the nested REPLIES of a given parent post.
 *
 * v0.1.0e.f (辉哥拍板 2026-08-20 08:18 — A1/B1/C2): zpc's
 * `NestedReplies.jsx` switched from `?filter[parent]=N` to
 * `?filter[ziven-post-comment:replies]=N` because once the
 * `TopLevelOnlyScope` global Eloquent scope is active, every
 * Post query (including the vendor PostIndex endpoint) is
 * automatically constrained to `parent_post_id IS NULL`. The
 * existing `ParentFilter` adds `where('parent_post_id', '=', N)`,
 * which composes with the global `whereNull` into
 * `parent_post_id IS NULL AND parent_post_id = N` — that
 * intentionally returns zero rows (a top-level post can never be
 * its own reply).
 *
 * `RepliesFilter` differs from `ParentFilter` in TWO ways:
 *   1. Different filter key (`ziven-post-comment:replies` vs
 *      `parent`). This avoids colliding with any future vendor
 *      filter and makes the intent obvious in the URL
 *      (`?filter[ziven-post-comment:replies]=6` is unambiguously
 *      "zpc wants the replies to post 6", whereas
 *      `?filter[parent]=6` could mean "the post that has parent
 *      6" or "the post with id 6" depending on context).
 *   2. The handler calls `$query->withoutGlobalScope(...)` to
 *      remove the `TopLevelOnlyScope` constraint before applying
 *      `where('parent_post_id', '=', $parentId)`. The resulting
 *      SQL is `parent_post_id = N` (no IS NULL clause), which
 *      correctly returns the children of post N.
 *
 * Why the existing `ParentFilter` is NOT removed:
 *   - v0.1.0e.b tests used `?filter[parent]=` and we want
 *     backwards compat for any third-party consumers of the
 *     public API. (E.g. if any future vendor extension or zpc
 *     admin tool wants to query by `parent` for an internal
 *     purpose, removing the filter would be a breaking change.)
 *   - `ParentFilter` with `?filter[parent]=null` still works
 *     (returns top-level posts), and is used by the
 *     zpc discussion list (since `parent_post_id IS NULL` is
 *     now redundant with the global scope but the explicit
 *     filter remains for clarity / vendor compat).
 *   - `ParentFilter` with `?filter[parent]=N` (specific parent)
 *     now returns zero rows due to the global scope. This is
 *     a behavior change but is the intended invariant — use
 *     `RepliesFilter` for that case. The frontend
 *     `NestedReplies.jsx` is the only known caller of
 *     `?filter[parent]=N` and it has been updated to
 *     `?filter[ziven-post-comment:replies]=N` in this commit.
 *
 * Usage:
 *   ?filter[ziven-post-comment:replies]=6  -> all replies to post #6
 *
 * @implements FilterInterface<DatabaseSearchState>
 */
class RepliesFilter implements FilterInterface
{
    use ValidateFilterTrait;

    public function getFilterKey(): string
    {
        // Use a namespaced filter key (vendor-prefix style) to
        // avoid collisions with future vendor filters. The colon
        // is the convention used by Flarum's search filter
        // language (cf. `discussion.state` etc.) for namespaced
        // attributes.
        return 'ziven-post-comment:replies';
    }

    public function filter(SearchState $state, string|array $value, bool $negate): void
    {
        $raw = $this->asString($value);
        $parentId = intval($raw);

        $query = $state->getQuery();

        // Remove the zpc TopLevelOnlyScope global scope so the
        // where('parent_post_id', '=', N) constraint actually
        // returns children (instead of being ANDed with
        // parent_post_id IS NULL, which yields an empty set).
        //
        // We explicitly target `TopLevelOnlyScope::class` rather
        // than calling `withoutGlobalScopes()` (which would
        // remove ALL scopes including vendor `RegisteredTypesScope`)
        // so we preserve the vendor type-based filter (e.g.
        // discussion event posts).
        $query->withoutGlobalScope(TopLevelOnlyScope::class);

        if ($negate) {
            $query->where('posts.parent_post_id', '!=', $parentId);
        } else {
            $query->where('posts.parent_post_id', '=', $parentId);
        }
    }
}
