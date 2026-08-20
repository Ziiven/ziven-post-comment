// NestedReplies — renders a list of nested replies under a top-level
// post, with a "展示更多" lazy-load button.
//
// v0.1.0e.b design (辉哥拍板 2026-08-19 20:49):
//   - DEFAULT 3: when the component mounts, the FIRST page of 3
//     nested replies is loaded from the API and rendered inline.
//   - "展示更多" +10: clicking the "展示更多" button fetches the
//     NEXT 10 replies (i.e. 13 total visible, then 23, then 33, …).
//   - Loop until exhausted: as long as there are more replies, the
//     "展示更多" button stays visible; once we have loaded all of
//     them, the button disappears.
//   - This matches WeChat 朋友圈 / 小黑盒 UX.
//
// v0.1.0e.a design (辉哥拍板 2026-08-19 16:24, 撤回 v0.1.0e 的 A2
// 无限层):
//   - SINGLE-LEVEL: a NestedReply does NOT render a NestedReplies
//     underneath itself. Only top-level posts host a NestedReplies
//     block. (WeChat 朋友圈 / 小黑盒 / 知乎 / 微博 all use 1-level
//     nested replies — the v0.1.0e 5-level infinite nesting was
//     wrong.)
//   - REPLYING: clicking the parent post's body (or a NestedReply's
//     body) opens the **vendor Flarum 2.0 composer** (走
//     `app.composer.load(NestedReplyComposer, { parentPost })`),
//     NOT a zpc inline textarea composer. (辉哥明确 "用 Flarum
//     原生 composer, 不是 zpc 自加的 inline composer".)
//
// Backed by:
//   - API: `?filter[ziven-post-comment:replies]=X` via the zpc
//     RepliesFilter (see src/Query/RepliesFilter.php, added in
//     v0.1.0e.f). vendor PostSearcher gets a custom filter so a
//     request like
//     `?filter[ziven-post-comment:replies]=6&page[offset]=0&page[limit]=3`
//     returns the first 3 children of post 6, ordered by
//     created_at ASC. The dedicated filter is needed because the
//     `TopLevelOnlyScope` global Eloquent scope (also added in
//     v0.1.0e.f) constrains all Post queries to top-level
//     (parent_post_id IS NULL); RepliesFilter explicitly removes
//     that scope before applying its `where('parent_post_id', '=',
//     X)` constraint.
//   - The repliesCount is already on every parent post (from
//     PostResourceFields::repliesCount via `countRelation`). It's
//     our source of truth for "are there more to load?".
//
// Important lifecycle notes:
//   - This component lives inside `CommentPost`, which is gated by
//     vendor Flarum 2.0's `SubtreeRetainer` (in
//     `AbstractPost.onbeforeupdate`). That retainer blocks redraws
//     unless `loading`, `freshness`, or the `user.freshness`
//     change. As a result, mutating `this.expanded` /
//     `this.replies` followed by `m.redraw()` does NOT re-render
//     this subtree in Flarum 2.0 — the parent `CommentPost`
//     short-circuits the diff.
//   - Fix strategy: `view()` always renders the full DOM tree
//     (replies list + "展示更多" button). The "visible" portion is
//     gated by `this.visibleCount` (a number we increment as the
//     user clicks "展示更多" or after the first fetch returns).
//     `oncreate` captures the wrapper / list / button elements so
//     the visibility can be toggled directly without a mithril
//     re-render — by toggling the `--show` class on each
//     `.NestedReplies-item` whose index is < `this.visibleCount`,
//     and toggling the "展示更多" button visibility based on
//     `this.visibleCount < this.replies.length`.
//   - The "first 3" + "next 10" UI logic runs at the API /
//     `this.replies` level — we don't pre-allocate 13 invisible
//     items, we actually fetch them.

import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import Button from 'flarum/common/components/Button';
import LoadingIndicator from 'flarum/common/components/LoadingIndicator';
import classList from 'flarum/common/utils/classList';

import NestedReply from './NestedReply';

// v0.1.0e.b: 辉哥 20:49 拍板的 3 + 10 模式。
// - DEFAULT_PAGE_SIZE = 3: 第一次 mount 时拉 3 条展示。
// - LOAD_MORE_SIZE = 10: 点"展示更多"按钮再拉 10 条。
const DEFAULT_PAGE_SIZE = 3;
const LOAD_MORE_SIZE = 10;

export default class NestedReplies extends Component {
  oninit(vnode) {
    super.oninit(vnode);

    this.loading = false;
    this.parentPost = this.attrs.post;

    // The list of nested-reply Post models that we've loaded so
    // far. Starts empty — we kick off a fetch in `oncreate` to load
    // the first 3.
    //
    // v0.1.0e.b: no longer pre-populated from
    // `this.parentPost.replies()`. The backend no longer
    // default-includes `replies` in the posts payload (D2 辉哥
    // 20:49), so the parent post's `replies` relationship is
    // empty in the initial payload anyway. We always lazy-load
    // via `?filter[ziven-post-comment:replies]=X&page[offset]=0&page[limit]=3`
    // (v0.1.0e.f: switched from `?filter[parent]=` to
    // `?filter[ziven-post-comment:replies]=` so the backend's
    // `TopLevelOnlyScope` global scope is explicitly removed for
    // this query — see `RepliesFilter` for the matching
    // handler).
    this.replies = [];

    // The number of items in `this.replies` that should be
    // VISIBLE. After the first fetch (3 items), this equals 3.
    // After the user clicks "展示更多" once and we append 10, this
    // equals 13. After another click, 23. Etc.
    this.visibleCount = 0;

    // Total number of nested replies (known from the parent's
    // `repliesCount()` field — `countRelation` on the backend). We
    // use this to decide whether to show the "展示更多" button.
    // Initialised lazily in `oncreate` once the parent model is
    // in the store with its `repliesCount` attribute populated.
    this.totalCount = 0;
  }

  oncreate(vnode) {
    super.oncreate(vnode);

    // Capture the wrapper element for direct DOM toggling. Vendor
    // Flarum 2.0's CommentPost uses a `SubtreeRetainer` (in
    // `AbstractPost.onbeforeupdate`) that blocks mithril
    // re-renders of this subtree on most state changes — so we
    // drive the visual changes off the DOM directly via these
    // `*El` references and CSS-class toggles.
    this.wrapperEl = vnode.dom;
    this.listEl = vnode.dom && vnode.dom.querySelector('.NestedReplies-list');
    this.buttonEl = vnode.dom
      ? vnode.dom.querySelector('.NestedReplies-loadMore')
      : null;
    this.loadingEl = vnode.dom
      ? vnode.dom.querySelector('.NestedReplies-loading')
      : null;

    // Pull `repliesCount` from the parent post. It's already on
    // the model (from the `repliesCount` field declared in
    // PostResourceFields). This is the total number of nested
    // replies; we use it to know whether the "展示更多" button
    // should be visible after a fetch.
    this.totalCount = this._readRepliesCount();
    this._applyButton();

    // Initial fetch: load the first 3 nested replies.
    this._fetchReplies(0, DEFAULT_PAGE_SIZE, { isInitial: true });

    // Apply the initial states (loading spinner off until the
    // first fetch kicks off).
    this._applyLoading();

    // v0.1.0e.a: listen for the `zpc:nestedReplyPosted` event
    // fired by NestedReplyComposer after a successful reply. The
    // event carries `{ parentPost }`; we reload the full reply
    // list if the parent matches ours (we lose track of what was
    // visible before, so simplest correct behavior is to refetch
    // page 1 and reset visibleCount to DEFAULT_PAGE_SIZE — the
    // user just posted, they want to see their reply at the top
    // of the list).
    this._zpcReplyPostedHandler = (data) => {
      const parentId = data && data.parentPost && data.parentPost.id
        ? data.parentPost.id()
        : null;
      if (parentId && this.parentPost && this.parentPost.id() === parentId) {
        // After a new reply, refresh `repliesCount` and refetch
        // the first page. Reset visibleCount so the user sees
        // the new reply at the top of the freshly-loaded list.
        this.totalCount = this._readRepliesCount();
        this._fetchReplies(0, DEFAULT_PAGE_SIZE, { isInitial: true });
      }
    };
    // Dynamic import — flarum/common/events is a webpack chunk
    // that may not be loaded at zpc dist's module body run time.
    import('flarum/common/events').then((mod) => {
      this._zpcAppEvents = mod.default || mod;
      this._zpcAppEvents.on('zpc:nestedReplyPosted', this._zpcReplyPostedHandler);
    }).catch(() => {
      // If events module can't be loaded, we just won't auto-
      // refresh after a reply. The user can still post replies.
    });
  }

  /**
   * Clean up the event listener so we don't leak when the component
   * is removed. `onremove` is the mithril lifecycle hook called
   * before the DOM node is detached.
   */
  onremove(vnode) {
    if (this._zpcReplyPostedHandler) {
      if (this._zpcAppEvents && typeof this._zpcAppEvents.off === 'function') {
        this._zpcAppEvents.off('zpc:nestedReplyPosted', this._zpcReplyPostedHandler);
      }
      this._zpcReplyPostedHandler = null;
      this._zpcAppEvents = null;
    }
    super.onremove(vnode);
  }

  /**
   * v0.1.0e.b: read the parent's `repliesCount` field. This is the
   * authoritative total — it comes from the `repliesCount`
   * `countRelation` in PostResourceFields, which counts all child
   * posts (not just the ones we've loaded into `this.replies`).
   * Returns 0 if the parent model doesn't have it yet (defensive).
   */
  _readRepliesCount() {
    const post = this.parentPost;
    if (!post || typeof post.repliesCount !== 'function') return 0;
    const n = post.repliesCount();
    return typeof n === 'number' && n >= 0 ? n : 0;
  }

  /**
   * Fetch a page of nested replies. Calls
   *   GET /api/posts?filter[ziven-post-comment:replies]=<parentId>&sort=createdAt
   *        &include=user&page[offset]=<offset>&page[limit]=<limit>
   * and appends the returned models to `this.replies`. After the
   * fetch, `this.visibleCount` is bumped to the new total, the
   * "展示更多" button visibility is recomputed, and the DOM is
   * re-rendered.
   *
   * @param {number} offset  how many to skip (0 for first page,
   *                         `this.replies.length` for next page).
   * @param {number} limit   how many to fetch (3 for initial, 10
   *                         for "展示更多" — 辉哥 20:49).
   * @param {object} opts
   * @param {boolean} [opts.isInitial=false] if true, REPLACE
   *                         `this.replies` rather than appending.
   *                         Used by the first fetch and by the
   *                         post-reply refresh.
   */
  _fetchReplies(offset, limit, opts) {
    if (this.loading) return;
    const isInitial = !!(opts && opts.isInitial);

    this.loading = true;
    this._applyLoading();

    const parentId = this.parentPost.id();
    const params = {
      // v0.1.0e.f: use `ziven-post-comment:replies` instead of
      // `parent` so the backend's `TopLevelOnlyScope` global
      // Eloquent scope is explicitly removed before applying the
      // `where('parent_post_id', '=', parentId)` constraint. With
      // the old `?filter[parent]=N`, the global `whereNull` ANDs
      // the explicit `= N` into an empty set, and NestedReplies
      // would render 0 items. The new filter returns the actual
      // children. See `src/Query/RepliesFilter.php` for the
      // matching backend handler.
      filter: { 'ziven-post-comment:replies': parentId },
      sort: 'createdAt',
      include: 'user',
      page: { offset, limit },
    };

    app.store
      .find('posts', params)
      .then((payload) => {
        let list;
        if (Array.isArray(payload)) {
          list = payload;
        } else if (payload && Array.isArray(payload.payload && payload.payload.data)) {
          list = payload.payload.data;
        } else {
          list = [];
        }

        const models = list
          .map((item) => {
            if (item && typeof item.id === 'function') return item;
            const id = (item && (item.id || (item.data && item.data.id))) || null;
            return id ? app.store.getById('posts', String(id)) : null;
          })
          .filter(Boolean);

        if (isInitial) {
          this.replies = models;
        } else {
          this.replies = this.replies.concat(models);
        }
        // Bump visibleCount to the total we now have loaded (or
        // to DEFAULT_PAGE_SIZE on initial, so we don't show more
        // than we explicitly asked for).
        this.visibleCount = isInitial
          ? Math.min(this.replies.length, DEFAULT_PAGE_SIZE)
          : this.replies.length;
        this.loading = false;
        this._applyLoading();
        this._render();
      })
      .catch(() => {
        this.loading = false;
        this._applyLoading();
        this._render();
      });
  }

  /**
   * "展示更多" button click handler. Fetches the next page of
   * replies (10 more) and appends to `this.replies`. 辉哥 20:49
   * 拍板: 每次 +10.
   */
  loadMore() {
    if (this.loading) return;
    this._fetchReplies(this.replies.length, LOAD_MORE_SIZE, { isInitial: false });
  }

  /**
   * Apply the visual change: render the current `this.replies`
   * array into the `<ul>` via direct DOM manipulation (creating
   * new `<li>` elements + mithril-rendering a NestedReply into
   * each), set per-item visibility based on `this.visibleCount`,
   * and toggle the "展示更多" button.
   *
   * Why direct DOM, not mithril re-render?
   *
   * This component lives inside vendor Flarum 2.0's CommentPost,
   * which uses a `SubtreeRetainer` (vendor/flarum/core/js/src/forum/
   * components/AbstractPost.tsx, onbeforeupdate) to block re-renders
   * of its subtree on most state changes. The retainer only allows
   * a rebuild when `this.loading`, `this.freshness()`, or
   * `this.user().freshness` change. Fetching nested replies
   * doesn't touch any of those, so a `m.redraw()` after the
   * fetch would NOT re-render this subtree — the parent's
   * SubtreeRetainer would short-circuit the diff.
   *
   * The fix is to bypass mithril for the items list and render
   * directly into the DOM:
   *   1. Clear the existing `<ul>` (`innerHTML = ''`).
   *   2. For each reply in `this.replies`, create a new `<li>`
   *      element and use `m.render()` to mount a NestedReply
   *      component into it. `m.render(element, vnode)` is
   *      mithril's documented one-shot render helper — it
   *      doesn't try to track vnodes for diffing, it just
   *      paints the vnode into the element.
   *   3. Set per-item `style.display` based on `visibleCount`.
   *   4. Update `data-visible-count` on the wrapper (for CSS
   *      / debugging hooks).
   *
   * This is the same pattern SOP 207 / 208 uses for the
   * expand/collapse toggle: the wrapper's data attribute is
   * the source of truth, and the items list is regenerated
   * imperatively rather than via the mithril virtual DOM.
   */
  _render() {
    if (this.wrapperEl) {
      this.wrapperEl.setAttribute('data-visible-count', String(this.visibleCount));
    }
    if (!this.listEl) {
      this._applyButton();
      return;
    }
    // Replace the items list with a fresh render. The previous
    // items (if any) are removed; the new items are mounted
    // from `this.replies`.
    const ul = this.listEl;
    ul.innerHTML = '';
    for (let i = 0; i < this.replies.length; i++) {
      const reply = this.replies[i];
      const li = document.createElement('li');
      li.className = 'NestedReplies-item';
      li.style.display = i < this.visibleCount ? '' : 'none';
      li.setAttribute('data-reply-id', String(reply.id()));
      // mithril 0.2.x `m.render(el, vnode)` is a one-shot render
      // helper — it paints the vnode into the element and
      // doesn't try to track vnodes for future diffing. This
      // matches what we want here: a fresh mount, no diffing
      // with the previous (now-removed) vnode.
      try {
        m.render(li, m(NestedReply, { reply }));
      } catch (e) {
        // mithril render can fail if the chunk for the
        // NestedReply component hasn't loaded yet (it's a
        // sibling chunk in zpc's webpack bundle). We catch
        // and continue — the next click of "展示更多" or
        // post-reply refresh will re-attempt the render.
      }
      ul.appendChild(li);
    }
    this._applyButton();
  }

  _applyLoading() {
    if (this.wrapperEl) {
      this.wrapperEl.classList.toggle('NestedReplies--loading', this.loading);
    }
    if (this.loadingEl) {
      this.loadingEl.style.display = this.loading ? 'flex' : 'none';
    }
  }

  _applyButton() {
    if (!this.buttonEl) return;
    // Show the "展示更多" button only if there are MORE replies to
    // load than what we currently have visible. The condition is:
    //   this.visibleCount < this.totalCount
    // (i.e. we've shown fewer than the total). When we reach the
    // end (this.visibleCount === this.totalCount), the button
    // disappears.
    const hasMore = this.visibleCount < this.totalCount;
    this.buttonEl.style.display = hasMore ? '' : 'none';
  }

  view() {
    // v0.1.0e.b: the items list is rendered imperatively in
    // `_render()` (using `m.render(li, m(NestedReply, ...))`),
    // NOT through the mithril virtual DOM. This bypasses the
    // parent CommentPost's `SubtreeRetainer` (vendor Flarum
    // 2.0), which blocks mithril re-renders of this subtree
    // on most state changes — including, crucially, after a
    // successful `app.store.find('posts', …)` fetch.
    //
    // The first mithril render (oncreate) produces an empty
    // `<ul class="NestedReplies-list"></ul>`. `_render()` is
    // called from `_fetchReplies()` to populate the list once
    // the fetch resolves, and from `loadMore()` to append more
    // items when the user clicks "展示更多".
    //
    // Everything else (the wrapper, loading indicator, "展示
    // 更多" button) is still rendered through mithril because
    // those don't depend on a changing reply list.
    const isEmpty = this.replies.length === 0 && !this.loading;

    return (
      <div
        className={classList('NestedReplies', {
          'NestedReplies--loading': this.loading,
          'NestedReplies--empty': isEmpty,
        })}
        data-visible-count={String(this.visibleCount)}
      >
        {/* Reply list — populated by `_render()`. The first
            mithril render (oncreate) leaves it empty; subsequent
            fetches call `_render()` which uses `m.render()` to
            imperatively mount NestedReply components into each
            `<li>`. The DOM is fully owned by `_render()` after
            mount. */}
        <ul className="NestedReplies-list" />

        {/* Loading spinner (only visible when
            `.NestedReplies--loading` is set on the wrapper — see
            `_applyLoading`). */}
        <div className="NestedReplies-loading" style="display: none;">
          <LoadingIndicator size="small" />
        </div>

        <div className="NestedReplies-controls">
          {/* v0.1.0e.b: "展示更多" 按钮 (辉哥 20:49 拍板).
              辉哥原话: "默认展示3条楼中楼的回复, 如果有更多的话就
              像小黑盒那样显示'展示更多', 点击后展示额外的10条,
              如果楼中楼还有更多回复就再次显示'展示更多', 直到
              楼中楼回复全部展示完为止".
              按钮永远渲染在 DOM 里 (CSS / _applyButton 决定是
              否可见), 这样可以避免 mithril 重渲后按钮丢失。 */}
          <Button
            className="Button Button--link NestedReplies-loadMore"
            style="display: none;"
            onclick={() => this.loadMore()}
          >
            {app.translator.trans('ziven-post-comment.forum.post.load_more_replies')}
          </Button>

          {/* v0.1.0e.a: removed the visible "Reply" button. The composer
              is now opened by clicking the parent post card
              (CommentPost) or the NestedReply card — a
              小黑盒-style UX. The card-click handlers in
              index.js / NestedReply.jsx call
              `app.composer.load(NestedReplyComposer, { parentPost })`
              directly. No zpc-specific composer button. */}
        </div>
      </div>
    );
  }
}
