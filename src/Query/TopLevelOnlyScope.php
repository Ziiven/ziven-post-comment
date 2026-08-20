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
 * (主楼) posts only — i.e. `posts.parent_post_id IS NULL` AND
 * `posts.type = 'comment'`.
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
 * v0.1.0e.i (辉哥拍板 2026-08-20 18:15): add `type = 'comment'`
 * constraint to also filter out vendor/flarum-tags event posts
 * (type='discussionTagged' for tag add/remove, type='discussionLocked',
 * etc.) which were also being returned by PostIndex as if they
 * were 主楼 (they have `parent_post_id IS NULL` because tag events
 * are at the discussion level, not a reply). 辉哥原话: "从后台
 * 接口处移除, 不是前端隐藏". So we extend the same global scope
 * (the v0.1.0e.f pattern) to do the type filtering at the Eloquent
 * layer too, instead of adding a vendor-API-level filter that would
 * need a separate code path.
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
 *     `withoutGlobalScope` removes BOTH the whereNull and the new
 *     where('type', 'comment') constraint, so replies can be
 *     queried normally (and in practice replies are always
 *     `type='comment'` anyway, since only `CommentPost::created`
 *     events set `type='comment'`).
 *   - `PostIndex` index endpoint (the main fix): now returns
 *     ONLY top-level comment posts in mixed order. vendor `loadNext` /
 *     `loadPrevious` consume that and the 主楼 list is correct.
 *     Tag event posts (`type='discussionTagged'`) and other vendor
 *     event types are now correctly excluded from the stream.
 *   - `PostIndex` show endpoint: unaffected, since it loads a
 *     single post by id.
 *   - `PostIndex` create endpoint: unaffected, since it's a write.
 *   - `PostIndex` update endpoint: unaffected, since it operates
 *     on a single existing post.
 *   - flarum/tags own logic (tag add/remove UI, save, etc.) is
 *     unaffected — those write paths don't go through the global
 *     scope composition with PostIndex. The event posts are still
 *     CREATED in the DB; they're just no longer returned by the
 *     main posts index endpoint (which is what 辉哥 wanted).
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

        // v0.1.0e.i: also restrict to `type = 'comment'` to exclude
        // vendor event posts (e.g. flarum/tags creates
        // `type='discussionTagged'` posts at the discussion level
        // — these have `parent_post_id IS NULL` so the v0.1.0e.f
        // whereNull alone was not enough to filter them out of the
        // main PostStream index).
        $builder->where('posts.type', 'comment');
    }
}
