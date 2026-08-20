<?php

/*
 * This file is part of ziiven/ziven-post-comment.
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Ziven\PostComment\Query;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;

/**
 * Global Eloquent scope that constrains Post queries to top-level
 * (主楼) posts only — i.e. `posts.parent_post_id IS NULL`.
 *
 * v0.1.0e.f (辉哥拍板 2026-08-20 08:18 — A1/B1/C2): this scope
 * fixes the Flarum 2.0 PostStream "mixed 20 posts" bug. Previously
 * zpc relied on `Extend\ApiResource::field('posts', mutator)` to
 * override `DiscussionResource::posts` (v0.1.0e.b), but the
 * PostIndex endpoint (`?filter[discussion]=N&page[limit]=20`) hits
 * `PostResource::scope()` which only calls `whereVisibleTo($actor)`
 * — no `whereNull('parent_post_id')` filter. Result: deep link
 * `/d/2/115` falls back to index=0 → `loadRange(0, 20)` → returns
 * mixed 20 (3 real 主楼 + 2 wrongly-judged-主楼 + 15 replies).
 *
 * Why a global scope (vs. overriding vendor `PostResource::scope`):
 *   1. `PostResource::scope` is a method, not a schema field — the
 *      `Extend\ApiResource::field` mutator API cannot replace it.
 *   2. vendor `Index` endpoint has no `setDefaultFilter` API, so
 *      we can't register a default filter that runs on every
 *      `?filter[discussion]=N` request.
 *   3. global scope runs at the Eloquent layer (below both the
 *      resource and the endpoint) — it covers ALL Post queries
 *      without each call site having to remember to filter. This
 *      is the same pattern vendor `Post::booted()` uses for
 *      `RegisteredTypesScope` (vendor/flarum/core/src/Post/Post.php:112).
 *
 * Why it doesn't break the 主楼-only intent:
 *   - `discussion.postIds()` (zpc v0.1.0e.b already overrides this
 *     with explicit `->whereNull('parent_post_id')` in
 *     `Extend\ApiResource::field('posts', ...)`) is composed with
 *     the global scope: both apply, both restrict to 主楼. Same
 *     result, doubly enforced.
 *   - `?filter[parent]=N` (zpc's `ParentFilter`) adds an explicit
 *     `where('posts.parent_post_id', '=', $parentId)`. Composed
 *     with the global `whereNull`, the SQL becomes
 *     `parent_post_id IS NULL AND parent_post_id = $parentId`,
 *     which is intentionally empty (it would only match top-level
 *     posts that have themselves as parent — impossible). The
 *     NestedReplies use case (parent is top-level, want its
 *     children) would return zero rows from this filter — so the
 *     frontend `NestedReplies.jsx` was switched to the new
 *     `?filter[ziven-post-comment:replies]=N` filter (see
 *     `RepliesFilter`), which calls `withoutGlobalScope()` first
 *     then applies the explicit `where('parent_post_id', '=', N)`.
 *   - `PostIndex` index endpoint (the main fix): now returns
 *     ONLY top-level posts in mixed order. vendor `loadNext` /
 *     `loadPrevious` consume that and the 主楼 list is correct.
 *   - `PostIndex` show endpoint: unaffected, since it loads a
 *     single post by id.
 *   - `PostIndex` create endpoint: unaffected, since it's a write.
 *   - `PostIndex` update endpoint: unaffected, since it operates
 *     on a single existing post.
 *
 * @see /Applications/MAMP/htdocs/Flarum/vendor/flarum/core/src/Post/Post.php:112
 *      (vendor uses the same `addGlobalScope(new RegisteredTypesScope)`
 *      pattern; this class is the zpc equivalent for the 主楼-only
 *      semantics of the v0.1.0e design.)
 */
class TopLevelOnlyScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        // Use the explicit `posts.parent_post_id` column reference
        // (with table prefix) to avoid ambiguous-column errors if
        // the outer query joins the same table under a different
        // alias (e.g. vendor PostIndex's `whereVisibleTo` join).
        $builder->whereNull('posts.parent_post_id');
    }
}
