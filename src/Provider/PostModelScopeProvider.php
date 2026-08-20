<?php

/*
 * This file is part of ziiven/ziven-post-comment.
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Ziven\PostComment\Provider;

use Flarum\Foundation\AbstractServiceProvider;
use Flarum\Post\Post;
use Ziven\PostComment\Query\TopLevelOnlyScope;

/**
 * Service provider that attaches zpc's `TopLevelOnlyScope` global
 * Eloquent scope to the `Post` model at boot time.
 *
 * v0.1.0e.f (辉哥拍板 2026-08-20 08:18 — A1/B1/C2): after this
 * provider runs, every `Post::query()` and `Post::whereVisibleTo(...)`
 * call (including the vendor `PostIndex` endpoint's) is
 * automatically constrained to top-level (主楼) posts
 * (`parent_post_id IS NULL`) — unless the caller explicitly
 * removes the scope via `withoutGlobalScope(TopLevelOnlyScope::class)`.
 * zpc's `RepliesFilter` does this for the
 * `?filter[ziven-post-comment:replies]=N` use case (fetching a
 * parent post's nested replies from the frontend
 * `NestedReplies.jsx`).
 *
 * Why a dedicated `AbstractServiceProvider`:
 *   - vendor `Post::booted()` already calls
 *     `static::addGlobalScope(new RegisteredTypesScope)`. We
 *     follow the same pattern but for our zpc-specific scope,
 *     registered from an extension service provider so it
 *     composes with the vendor scope (both apply, both are
 *     explicit constraints, both can be selectively removed).
 *   - The provider is registered in `extend.php` via
 *     `(new Extend\ServiceProvider())->register(...)`. It runs
 *     during Flarum's boot sequence, AFTER all extensions are
 *     loaded but BEFORE the first request hits the Eloquent
 *     layer.
 *   - The provider is small (one `boot()` call). It does not
 *     need any constructor dependencies — it just hooks the
 *     scope into the model. This is intentionally minimal so
 *     the cost of registration is one line in `extend.php`.
 *
 * Boot order:
 *   1. Flarum core boots; vendor `Post::booted()` runs and
 *      attaches `RegisteredTypesScope`.
 *   2. zpc extension boots; `PostModelScopeProvider::boot()`
 *      runs and attaches `TopLevelOnlyScope`.
 *   3. After this, every Post query has BOTH scopes applied
 *      (e.g. `WHERE type IN (...) AND parent_post_id IS NULL`).
 *      This is the desired behavior — the vendor filter
 *      restricts to valid post types (CommentPost etc.), and
 *      the zpc filter restricts to top-level posts (主楼).
 *
 * @see /Applications/MAMP/htdocs/Flarum/vendor/flarum/core/src/Post/Post.php:112
 *      (vendor `addGlobalScope(new RegisteredTypesScope)` — same
 *      pattern, same provider shape.)
 */
class PostModelScopeProvider extends AbstractServiceProvider
{
    public function boot(): void
    {
        // Attach the scope. The vendor `Post::boot()` has already
        // attached `RegisteredTypesScope`; we add ours alongside
        // it. Eloquent's global-scope mechanism composes all
        // active scopes with AND, so the final query is
        // restricted to BOTH valid types AND top-level posts.
        Post::addGlobalScope(new TopLevelOnlyScope);
    }
}
