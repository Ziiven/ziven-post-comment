// NestedReplies — renders a collapsible list of nested replies under a
// top-level post, with a "View N more" lazy-load affordance.
//
// Behaviour (v0.1.0d — supersedes v0.1.0c):
//   - Always shows the first 3 replies inline.
//   - If there are > 3 replies and the user has not expanded, shows a
//     "View N more" button (where N = total - 3).
//   - When expanded, shows all loaded replies + a "Collapse" button.
//   - ReplyComposer is HIDDEN by default; user clicks the "Reply" button
//     (or the parent post's "Reply" action) to show the inline composer.
//     This avoids the v0.1.0c "composer is always visible" UX that
//     辉哥 flagged in the real-browser test (a textarea showing under
//     every post is noisy and not the expected pattern).
//   - Empty post (no replies yet) + composer hidden: shows ONLY the
//     "Reply" button. No list, no "View N more", no loading spinner.
//     This is the v0.1.0d Bug 3 fix — oninit no longer auto-loads
//     replies when the in-memory list is empty (which was triggering
//     the loading spinner forever on posts that legitimately have no
//     nested replies yet).
//
// IMPORTANT: This component lives inside `CommentPost`, which is gated
// by vendor Flarum 2.0's `SubtreeRetainer` (in `AbstractPost.onbeforeupdate`).
// That retainer blocks redraws unless `loading`, `freshness`, or the
// `user.freshness` change. As a result, mutating `this.composerShown`
// (or any other non-loading state) followed by `m.redraw()` does NOT
// re-render this subtree in Flarum 2.0 — the parent `CommentPost`
// short-circuits the diff.
//
// Fix strategy (v0.1.0d — composer toggle via direct DOM, complementing
// the v0.1.0c `_applyExpanded()` pattern):
//   1. `view()` always renders the full DOM tree (list + controls +
//      composer container). The composer container is in the DOM
//      regardless of `composerShown`; its visibility is driven by a
//      CSS class on the wrapper (`.NestedReplies--composer-shown`),
//      set/toggled in `_applyComposer()`.
//   2. `oncreate()` captures `composerEl` so subsequent clicks can
//      toggle its visibility directly without needing a mithril
//      re-render (SubtreeRetainer would block it).
//   3. `_applyComposer()` toggles the `--composer-shown` class on the
//      wrapper; CSS handles the actual `display: block / none` swap
//      on `.NestedReplies-composer`.
//
// This is the same pattern v0.1.0c uses for expand/collapse (see
// `_applyExpanded()`), extended to cover the new "composer shown"
// state. The wrapper element is the single source of truth for the
// three orthogonal visual states: expanded, composer-shown, loading.
//
// Empty-state fast path (Bug 3):
//   The old oninit auto-loaded replies when `this.replies.length === 0`,
//   which set `this.loading = true` and rendered a permanent loading
//   spinner on posts that just had no nested replies yet (the API
//   would return an empty array, the spinner would briefly flash, then
//   stop — but the spinner was already visible to the user during the
//   fetch, and for posts that the backend's pre-include already gave us
//   an empty relationship for, it was a permanent "loading" indicator
//   on something that would never load anything useful).
//   v0.1.0d simply does not auto-load. If the user wants to view
//   replies that the discussion payload didn't include, they have to
//   click something to trigger the fetch (and as of v0.1.0d there is
//   no such affordance — the in-DOM list IS the only reply list,
//   matching the "first 3 visible + view N more" pattern).

import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import Button from 'flarum/common/components/Button';
import LoadingIndicator from 'flarum/common/components/LoadingIndicator';
import classList from 'flarum/common/utils/classList';

import NestedReply from './NestedReply';
import ReplyComposer from './ReplyComposer';

const VISIBLE_THRESHOLD = 3;

export default class NestedReplies extends Component {
  oninit(vnode) {
    super.oninit(vnode);

    this.expanded = false;
    this.loading = false;
    // v0.1.0d: composer is hidden by default; user clicks the
    // "Reply" button (or the parent post's "Reply" action) to show it.
    this.composerShown = false;
    this.parentPost = this.attrs.post;

    // Pre-fetch a list of the parent's replies (via API) so we have
    // something to render even if the post wasn't included in the
    // initial discussion payload. (The backend defaults to including
    // them, but this guards against deep links / pagination.)
    this.replies = this.parentPost.replies() || [];

    // v0.1.0d Bug 3 fix: DO NOT auto-load when the in-memory list is
    // empty. The previous behavior set `this.loading = true` and
    // rendered a permanent LoadingIndicator on posts that legitimately
    // have no nested replies yet. The visual is now simply "no
    // NestedReplies list + a Reply button" — clean and quiet.
    // (If we ever need to lazy-load replies that aren't pre-included,
    // we'll add a dedicated affordance later, but as of v0.1.0d the
    // first 3 are always shown inline and the list itself is the
    // source of truth.)
  }

  /**
   * Re-fetch the parent's replies (used after a new reply is posted
   * via the inline composer). This is the v0.1.0d "reload" path —
   * v0.1.0c just optimistically pushed the new reply into
   * `this.replies`; v0.1.0d prefers a fresh fetch so the
   * `repliesCount` on the parent post and the post stream stay in
   * sync with the server (the `addDefaultInclude` setting in the
   * V 测 V4 acceptance test requires this).
   */
  reloadReplies() {
    if (this.loading) return;
    this.loading = true;
    this._applyLoading();
    const parentId = this.parentPost.id();

    app.store
      .find('posts', {
        filter: { parent: parentId },
        sort: 'createdAt',
        include: 'user',
      })
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

        this.replies = models;
        this.loading = false;
        this._applyLoading();
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      })
      .catch(() => {
        this.loading = false;
        this._applyLoading();
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      });
  }

  oncreate(vnode) {
    super.oncreate(vnode);
    // Capture the wrapper element for direct DOM toggling of the
    // expanded / composer-shown / loading states. Vendor Flarum 2.0's
    // CommentPost uses a `SubtreeRetainer` (in
    // `AbstractPost.onbeforeupdate`) that blocks mithril re-renders of
    // this subtree on most state changes — so we drive the visual
    // changes off the DOM directly via these `*El` references and
    // CSS-class toggles. See SOP 207 / 208.
    this.wrapperEl = vnode.dom;
    this.listEl = vnode.dom && vnode.dom.querySelector('.NestedReplies-list');
    this.itemEls = vnode.dom
      ? Array.from(vnode.dom.querySelectorAll('.NestedReplies-item'))
      : [];
    this.composerEl = vnode.dom
      ? vnode.dom.querySelector('.NestedReplies-composer')
      : null;
    // Capture the loading element so `reloadReplies()` can show /
    // hide the spinner without a mithril re-render. The element is
    // always present in the DOM (see view()), but it's only visible
    // when the wrapper has `--loading` (toggled in `_applyLoading`).
    this.loadingEl = vnode.dom
      ? vnode.dom.querySelector('.NestedReplies-loading')
      : null;

    // v0.1.0e: stash the mithril instance on the wrapper DOM node
    // so the card-click handlers in CommentPost and NestedReply
    // (which fire from `e.target.closest('.NestedReplies')` lookups
    // in native event listeners) can find this instance and call
    // `showComposer()` / `toggleComposer()` on it. mithril's
    // reconciler does not expose a built-in way to recover the
    // component instance from a DOM node (the vnode goes through
    // mithril's `pool` / `view()` cycle without leaving a
    // reference on the DOM), so we do it ourselves.
    if (this.wrapperEl) {
      this.wrapperEl.__zpcNestedReplies = this;
    }

    // Apply the initial composer-shown state (always false on first
    // mount, but we set it explicitly to be robust to any future
    // init-time state).
    this._applyComposer();
    this._applyLoading();
  }

  /**
   * v0.1.0e: clean up the DOM reference to the mithril instance
   * when the component is removed. Without this, the global-ish
   * reference could prevent the GC from collecting the component
   * (the wrapper element would still hold a strong ref to the
   * component instance, which in turn holds DOM refs, etc.).
   * `onremove` is the mithril lifecycle hook called before the
   * DOM node is detached.
   */
  onremove(vnode) {
    if (this.wrapperEl) {
      this.wrapperEl.__zpcNestedReplies = null;
    }
    super.onremove(vnode);
  }

  /**
   * Toggle the expanded state and apply the visual change directly to
   * the DOM. We track `this.expanded` so that subsequent mithril
   * re-renders (e.g. after a reply is posted) render the correct
   * initial shape, but we do NOT rely on mithril to apply the click
   * feedback — vendor Flarum 2.0's `SubtreeRetainer` blocks it.
   */
  expand() {
    if (this.expanded) return;
    this.expanded = true;
    this._applyExpanded();
  }

  collapse() {
    if (!this.expanded) return;
    this.expanded = false;
    this._applyExpanded();
  }

  _applyExpanded() {
    if (this.wrapperEl) {
      this.wrapperEl.classList.toggle('NestedReplies--expanded', this.expanded);
    }
    if (this.itemEls && this.itemEls.length) {
      for (let i = VISIBLE_THRESHOLD; i < this.itemEls.length; i++) {
        this.itemEls[i].classList.toggle(
          'NestedReplies-item--hidden',
          !this.expanded,
        );
      }
    }
  }

  /**
   * Toggle the inline composer's visibility. v0.1.0d: the composer
   * is hidden by default; this method flips it on/off without a
   * mithril re-render (SubtreeRetainer would block it). The wrapper
   * element gets a `--composer-shown` class; CSS then swaps
   * `display: none / block` on the composer container.
   *
   * v0.1.0e: this method is now also the public API used by the
   * parent CommentPost / NestedReply card-click handlers to open the
   * composer when the user clicks the entire post / reply card
   * (小黑盒-style "click anywhere on the card to reply" UX). We
   * deliberately do NOT also use the auto-closing "View N more"
   * button or any other trigger — this method is the single source
   * of truth for composer visibility.
   */
  toggleComposer() {
    this.composerShown = !this.composerShown;
    this._applyComposer();
  }

  /**
   * v0.1.0e: public method to forcibly show the inline composer
   * (regardless of its current state). Used by the card-click
   * handler — the user expects a single click to open the composer
   * (idempotent), and `toggleComposer()` would close it on a second
   * accidental click. The DOM update is direct (SOP 207 / 208
   * pattern — no mithril redraw, because vendor Flarum 2.0's
   * `SubtreeRetainer` blocks re-renders of this subtree).
   */
  showComposer() {
    if (this.composerShown) return;
    this.composerShown = true;
    this._applyComposer();
  }

  /**
   * v0.1.0e: public method to forcibly hide the inline composer.
   * Mirrors `showComposer()`. The DOM update is direct for the same
   * reason as `showComposer()` (SOP 207 / 208).
   */
  hideComposer() {
    if (!this.composerShown) return;
    this.composerShown = false;
    this._applyComposer();
  }

  _applyComposer() {
    if (this.wrapperEl) {
      this.wrapperEl.classList.toggle('NestedReplies--composer-shown', this.composerShown);
    }
    if (this.composerEl) {
      this.composerEl.style.display = this.composerShown ? 'block' : 'none';
    }
  }

  _applyLoading() {
    if (this.wrapperEl) {
      this.wrapperEl.classList.toggle('NestedReplies--loading', this.loading);
    }
    if (this.loadingEl) {
      this.loadingEl.style.display = this.loading ? 'flex' : 'none';
    }
  }

  /**
   * Called by the inline ReplyComposer after a new reply is posted.
   * v0.1.0e: SOP 208 DOM-append path. Hides the composer (the composer
   * is a transient "I'm replying" panel — once the reply is in, it
   * should close) and appends the new reply directly to the DOM, by-
   * passing the mithril re-render that vendor Flarum 2.0's
   * SubtreeRetainer would otherwise block. We still call
   * `reloadReplies()` in the background so the list stays in sync with
   * the server (and so the `repliesCount` on the parent post is
   * correct), but the user sees the new reply *immediately* via the
   * DOM-append, not after a fetch roundtrip.
   *
   * The DOM-append is necessary because, in v0.1.0d, we relied on
   * `m.redraw()` inside `_onposted` to re-evaluate the list — but
   * SubtreeRetainer (`AbstractPost.onbeforeupdate`) blocks re-renders
   * of the CommentPost subtree, so the new reply only showed up after
   * a full page reload. V 测 V5 confirmed this with the "API direct
   * create reply" test: DB had the reply, but the in-page list didn't
   * show it. (See SOP 207 / 208 for the full SubtreeRetainer
   * rationale.)
   */
  _onposted(newReply) {
    this.composerShown = false;
    this._applyComposer();

    if (newReply) {
      // Optimistically append to our in-memory list so any subsequent
      // mithril pass (if it ever happens) renders the right number of
      // items. The DOM update below is the user-visible change.
      this.replies = [...this.replies, newReply];

      // Update the parent post's `repliesCount` so the rest of the page
      // (post stream, notification logic, etc.) sees a consistent
      // count. We write the model attribute directly; the next
      // `reloadReplies()` will reconcile with the server's count.
      if (this.parentPost) {
        const current =
          typeof this.parentPost.repliesCount === 'function'
            ? this.parentPost.repliesCount()
            : (this.parentPost.data && this.parentPost.data.attributes
                ? this.parentPost.data.attributes.repliesCount
                : 0) || 0;
        if (this.parentPost.data && this.parentPost.data.attributes) {
          this.parentPost.data.attributes.repliesCount = current + 1;
        }
      }

      // SOP 208 DOM-append: build the new <li> with manual DOM APIs
      // (bypassing mithril's reconciler, which is blocked by
      // SubtreeRetainer), then append it to the list element. We
      // also create the list <ul> on the fly if this wrapper is
      // currently in `--empty` state (no replies yet) — the new reply
      // turns an empty post into a post-with-replies, so the list
      // container must exist before we can append the item.
      if (!this.listEl) {
        this._createListEl();
      }

      if (this.listEl) {
        const newLi = this._buildNewReplyLi(newReply);
        this.listEl.appendChild(newLi);
        // Refresh `itemEls` so subsequent expand/collapse / hidden-
        // state toggles include the new item.
        this.itemEls = this.listEl
          ? Array.from(this.listEl.querySelectorAll('.NestedReplies-item'))
          : [];
      }

      // The wrapper's `--empty` class is no longer accurate (we just
      // added a reply). Remove it directly so the empty-state styling
      // (Reply button re-styled as a primary CTA, no list gap, etc.)
      // no longer applies.
      if (this.wrapperEl && this.wrapperEl.classList.contains('NestedReplies--empty')) {
        this.wrapperEl.classList.remove('NestedReplies--empty');
      }

      // Re-evaluate which items are hidden (the new item is at the
      // tail, so it should be visible if total <= VISIBLE_THRESHOLD
      // and hidden if total > VISIBLE_THRESHOLD and not expanded).
      this._applyExpanded();
    }

    // Background re-fetch keeps the list in sync with the server (in
    // case anything changed in between — e.g. a different user
    // replied, or the server-side `repliesCount` differs from the
    // optimistic +1 we just wrote). If SubtreeRetainer blocks the
    // resulting re-render, the DOM-append above is the visible
    // result, so this is purely a "background correctness" pass.
    this.reloadReplies();
  }

  /**
   * v0.1.0e (SOP 208): Create the `<ul class="NestedReplies-list">`
   * element on the fly, for the case where the wrapper is in
   * `--empty` state (no replies, no list in the DOM) and a new reply
   * just arrived. The list is inserted before the controls row so
   * the DOM order matches what `view()` would have produced.
   */
  _createListEl() {
    if (!this.wrapperEl) return;
    const ul = document.createElement('ul');
    ul.className = 'NestedReplies-list';
    const controls = this.wrapperEl.querySelector('.NestedReplies-controls');
    if (controls && controls.parentNode === this.wrapperEl) {
      this.wrapperEl.insertBefore(ul, controls);
    } else {
      this.wrapperEl.appendChild(ul);
    }
    this.listEl = ul;
  }

  /**
   * v0.1.0e (SOP 208): Build a single `<li class="NestedReplies-item">`
   * containing a `<article class="NestedReply">` mirroring the
   * structure that `NestedReply.jsx`'s `view()` would produce. We
   * build it with manual DOM APIs instead of mithril's render
   * because (a) mithril's reconciler is blocked by SubtreeRetainer
   * in this subtree, and (b) the NestedReply subtree doesn't have
   * any interactive controls that need mithril lifecycle (the avatar
   * and time links are plain anchors), so DOM construction is
   * equivalent.
   *
   * The content (`newReply.contentHtml()`) is set via `innerHTML`
   * directly — the backend has already sanitized the HTML (the
   * existing v0.1.0d code uses `m.trust(reply.contentHtml())` for
   * this exact reason), so this is not a new XSS surface.
   */
  _buildNewReplyLi(newReply) {
    const li = document.createElement('li');
    li.className = 'NestedReplies-item';
    li.setAttribute('data-reply-id', newReply.id());

    const article = document.createElement('article');
    article.className = 'NestedReply';

    // Resolve user (may be null if the post payload didn't include it
    // — we still render a placeholder so the layout doesn't shift).
    const user = typeof newReply.user === 'function' ? newReply.user() : null;
    const userName = user && user.displayName ? user.displayName() : 'Unknown';
    const userHref = user ? app.route.user(user) : '#';
    const avatarUrl = user && user.avatarUrl ? user.avatarUrl() : '';

    // ---- avatar
    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'NestedReply-avatar';
    const avatarLink = document.createElement('a');
    avatarLink.href = userHref;
    const avatarImg = document.createElement('img');
    avatarImg.className = 'NestedReply-avatar-img Avatar';
    if (avatarUrl) avatarImg.src = avatarUrl;
    avatarImg.alt = userName;
    avatarImg.loading = 'lazy';
    avatarLink.appendChild(avatarImg);
    avatarWrap.appendChild(avatarLink);
    article.appendChild(avatarWrap);

    // ---- body
    const body = document.createElement('div');
    body.className = 'NestedReply-body';

    // ---- header (author + time)
    const header = document.createElement('header');
    header.className = 'NestedReply-header';
    const authorLink = document.createElement('a');
    authorLink.className = 'NestedReply-author';
    authorLink.href = userHref;
    authorLink.textContent = userName;
    header.appendChild(authorLink);

    const timeLink = document.createElement('a');
    timeLink.className = 'NestedReply-time';
    timeLink.href = app.route.post(newReply);
    const createdAt = typeof newReply.createdAt === 'function'
      ? newReply.createdAt()
      : new Date();
    timeLink.title = createdAt.toLocaleString();
    timeLink.textContent = createdAt.toLocaleString();
    header.appendChild(timeLink);

    body.appendChild(header);

    // ---- content (HTML from the backend, same as m.trust in
    // NestedReply.jsx — server has sanitized the markup).
    const content = document.createElement('div');
    content.className = 'NestedReply-content';
    const contentHtml = typeof newReply.contentHtml === 'function'
      ? newReply.contentHtml()
      : '';
    content.innerHTML = contentHtml || '<p></p>';
    body.appendChild(content);

    article.appendChild(body);
    li.appendChild(article);

    return li;
  }

  view() {
    const total = this.replies.length;
    const hiddenCount = Math.max(0, total - VISIBLE_THRESHOLD);
    const showExpandButton = total > VISIBLE_THRESHOLD;
    const isEmpty = total === 0;

    return (
      <div
        className={classList('NestedReplies', {
          'NestedReplies--expanded': this.expanded,
          'NestedReplies--loading': this.loading,
          'NestedReplies--empty': isEmpty,
        })}
      >
        {/* Reply list (hidden when there are no replies). When non-empty
            we always render ALL items (not a slice) so the CSS-hidden
            pattern from v0.1.0c keeps working — items beyond
            VISIBLE_THRESHOLD get `.NestedReplies-item--hidden` until
            the wrapper has `--expanded`. */}
        {!isEmpty && (
          <ul className="NestedReplies-list">
            {this.replies.map((reply, idx) => (
              <li
                className={classList('NestedReplies-item', {
                  'NestedReplies-item--hidden':
                    !this.expanded && idx >= VISIBLE_THRESHOLD,
                })}
                key={'reply-' + reply.id()}
              >
                <NestedReply reply={reply} />
              </li>
            ))}
          </ul>
        )}

        {/* Loading spinner (only visible when `.NestedReplies--loading`
            is set on the wrapper — see `_applyLoading`). */}
        <div className="NestedReplies-loading" style="display: none;">
          <LoadingIndicator size="small" />
        </div>

        <div className="NestedReplies-controls">
          {/* View more / Collapse are both always rendered when there are
              more than VISIBLE_THRESHOLD replies. v0.1.0c pattern: the
              wrapper's `--expanded` class (toggled via direct DOM in
              `_applyExpanded()`) drives the visual swap via CSS — the
              vendor Flarum 2.0 SubtreeRetainer blocks mithril
              re-renders, so we cannot rely on `view()` to gate which
              button is in the DOM. The two buttons are always present
              when the post has enough replies; CSS shows one and hides
              the other based on the wrapper class. */}
          {!isEmpty && showExpandButton && (
            <Button
              className="Button Button--link NestedReplies-viewMore"
              onclick={() => this.expand()}
            >
              {app.translator.trans('ziven-post-comment.forum.post.view_more_replies', {
                count: hiddenCount,
              })}
            </Button>
          )}

          {!isEmpty && showExpandButton && (
            <Button
              className="Button Button--link NestedReplies-collapse"
              onclick={() => this.collapse()}
            >
              {app.translator.trans('ziven-post-comment.forum.post.collapse_replies')}
            </Button>
          )}

          {/* v0.1.0e: removed the visible "Reply" button. The composer is
              now opened by clicking anywhere on the parent post card
              (CommentPost) or the parent reply card (NestedReply) — a
              小黑盒-style UX. The card-click handlers call this
              component's `showComposer()` / `toggleComposer()` public
              methods. The viewer's primary affordance for replying is
              the card itself, not a separate button. */}
        </div>

        {/* Inline composer container — always in the DOM, but
            `display: none` by default (see CSS). v0.1.0d: the user
            must click the "Reply" button to show it. We render the
            ReplyComposer component unconditionally inside; the
            visibility of the container drives whether the user can
            actually see / interact with it. */}
        <div className="NestedReplies-composer" style="display: none;">
          {app.session.user && this.parentPost.discussion().canReply() && (
            <ReplyComposer
              parentPost={this.parentPost}
              onposted={(newReply) => this._onposted(newReply)}
            />
          )}
        </div>
      </div>
    );
  }
}
