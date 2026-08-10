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

    // Apply the initial composer-shown state (always false on first
    // mount, but we set it explicitly to be robust to any future
    // init-time state).
    this._applyComposer();
    this._applyLoading();
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
   */
  toggleComposer() {
    this.composerShown = !this.composerShown;
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
   * Hides the composer (per v0.1.0d UX: the composer is a transient
   * "I'm replying" panel — once the reply is in, it should close)
   * and re-fetches the parent's reply list so the new entry appears.
   */
  _onposted(newReply) {
    this.composerShown = false;
    this._applyComposer();
    // Optimistically append for snappy UX, then refetch in the
    // background to keep the list in sync with the server.
    if (newReply) {
      this.replies = [...this.replies, newReply];
    }
    this.reloadReplies();
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

          <Button
            className="Button Button--link NestedReplies-replyBtn"
            onclick={() => this.toggleComposer()}
          >
            {app.translator.trans('ziven-post-comment.forum.post.reply')}
          </Button>
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
