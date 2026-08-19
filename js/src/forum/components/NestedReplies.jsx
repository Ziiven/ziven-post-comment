// NestedReplies — renders a collapsible list of nested replies under a
// top-level post, with a "View N more" lazy-load affordance.
//
// v0.1.0e.a design (辉哥拍板 2026-08-19 16:24, 撤回 v0.1.0e 的 A2 无限层):
//   - SINGLE-LEVEL: a NestedReply does NOT render a NestedReplies
//     underneath itself. Only top-level posts host a NestedReplies
//     block. (WeChat 朋友圈 / 小黑盒 / 知乎 / 微博 all use 1-level
//     nested replies — the v0.1.0e 5-level infinite nesting was
//     wrong. See A2 in the task description.)
//   - REPLYING: clicking the parent post's body (or a NestedReply's
//     body) opens the **vendor Flarum 2.0 composer** (走
//     `app.composer.load(NestedReplyComposer, { parentPost })`),
//     NOT a zpc inline textarea composer. (辉哥明确 "用 Flarum
//     原生 composer, 不是 zpc 自加的 inline composer".)
//   - This component therefore has NO composer-state: no
//     `composerShown`, no `showComposer()`, no `hideComposer()`,
//     no `toggleComposer()`. The card-click handlers in
//     `index.js` and `NestedReply.jsx` directly call
//     `app.composer.load(NestedReplyComposer, { parentPost })`.
//   - On a successful nested-reply post, the vendor composer's
//     onsuccess fires a `zpc:nestedReplyPosted` event (see
//     NestedReplyComposer.js). NestedReplies listens for this
//     event and refreshes the parent's `replies` list. The
//     DOM-append helper from v0.1.0d (SOP 208) is removed — the
//     vendor composer's success path + the event listener is
//     simpler and more correct (the post stream update kicks in
//     automatically when `app.viewingDiscussion(discussion)`
//     matches, and we additionally fetch the parent's replies).
//
// Behaviour:
//   - Always shows the first 3 replies inline.
//   - If there are > 3 replies and the user has not expanded, shows a
//     "View N more" button (where N = total - 3).
//   - When expanded, shows all loaded replies + a "Collapse" button.
//   - Empty post (no replies yet): shows the list area in --empty
//     state (no "View N more" / "Collapse" — there's nothing to
//     view yet; the user can click the parent post body to
//     open the vendor composer and add the first reply).
//
// IMPORTANT: This component lives inside `CommentPost`, which is gated
// by vendor Flarum 2.0's `SubtreeRetainer` (in `AbstractPost.onbeforeupdate`).
// That retainer blocks redraws unless `loading`, `freshness`, or the
// `user.freshness` change. As a result, mutating `this.expanded`
// followed by `m.redraw()` does NOT re-render this subtree in
// Flarum 2.0 — the parent `CommentPost` short-circuits the diff.
//
// Fix strategy (v0.1.0c):
//   1. `view()` always renders the full DOM tree (list + controls).
//   2. `oncreate()` captures the wrapper / list / item / loading
//      elements so subsequent clicks can toggle visibility directly
//      without needing a mithril re-render (SubtreeRetainer would
//      block it).
//   3. `_applyExpanded()` toggles the `--expanded` class on the
//      wrapper; CSS handles the actual `display: block / none` swap
//      on `.NestedReplies-item--hidden`.
//   4. `_applyLoading()` toggles the `--loading` class for the
//      spinner.

import app from 'flarum/forum/app';
import appEvents from 'flarum/common/events';
import Component from 'flarum/common/Component';
import Button from 'flarum/common/components/Button';
import LoadingIndicator from 'flarum/common/components/LoadingIndicator';
import classList from 'flarum/common/utils/classList';

import NestedReply from './NestedReply';

const VISIBLE_THRESHOLD = 3;

export default class NestedReplies extends Component {
  oninit(vnode) {
    super.oninit(vnode);

    this.expanded = false;
    this.loading = false;
    this.parentPost = this.attrs.post;

    // Pre-fetch a list of the parent's replies (via API) so we have
    // something to render even if the post wasn't included in the
    // initial discussion payload. (The backend defaults to including
    // them, but this guards against deep links / pagination.)
    this.replies = this.parentPost.replies() || [];
  }

  oncreate(vnode) {
    super.oncreate(vnode);
    // Capture the wrapper element for direct DOM toggling of the
    // expanded / loading states. Vendor Flarum 2.0's CommentPost
    // uses a `SubtreeRetainer` (in `AbstractPost.onbeforeupdate`)
    // that blocks mithril re-renders of this subtree on most state
    // changes — so we drive the visual changes off the DOM directly
    // via these `*El` references and CSS-class toggles.
    this.wrapperEl = vnode.dom;
    this.listEl = vnode.dom && vnode.dom.querySelector('.NestedReplies-list');
    this.itemEls = vnode.dom
      ? Array.from(vnode.dom.querySelectorAll('.NestedReplies-item'))
      : [];
    this.loadingEl = vnode.dom
      ? vnode.dom.querySelector('.NestedReplies-loading')
      : null;

    // Apply the initial states.
    this._applyLoading();

    // v0.1.0e.a: listen for the `zpc:nestedReplyPosted` event
    // fired by NestedReplyComposer after a successful reply. The
    // event carries `{ parentPost }`; we reload replies if the
    // parent matches ours.
    this._zpcReplyPostedHandler = (data) => {
      const parentId = data && data.parentPost && data.parentPost.id
        ? data.parentPost.id()
        : null;
      if (parentId && this.parentPost && this.parentPost.id() === parentId) {
        this.reloadReplies();
      }
    };
    appEvents.on('zpc:nestedReplyPosted', this._zpcReplyPostedHandler);
  }

  /**
   * Clean up the event listener so we don't leak when the component
   * is removed. `onremove` is the mithril lifecycle hook called
   * before the DOM node is detached.
   */
  onremove(vnode) {
    if (this._zpcReplyPostedHandler) {
      appEvents.off('zpc:nestedReplyPosted', this._zpcReplyPostedHandler);
      this._zpcReplyPostedHandler = null;
    }
    super.onremove(vnode);
  }

  /**
   * Re-fetch the parent's replies (used after a new reply is posted
   * via the vendor composer + the zpc:nestedReplyPosted event).
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

  /**
   * Toggle the expanded state and apply the visual change directly to
   * the DOM. We track `this.expanded` so that subsequent mithril
   * re-renders render the correct initial shape, but we do NOT rely
   * on mithril to apply the click feedback — vendor Flarum 2.0's
   * `SubtreeRetainer` blocks it.
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

  _applyLoading() {
    if (this.wrapperEl) {
      this.wrapperEl.classList.toggle('NestedReplies--loading', this.loading);
    }
    if (this.loadingEl) {
      this.loadingEl.style.display = this.loading ? 'flex' : 'none';
    }
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
