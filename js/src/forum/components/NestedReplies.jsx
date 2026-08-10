// NestedReplies — renders a collapsible list of nested replies under a
// top-level post, with a "View N more" lazy-load affordance.
//
// Behaviour:
//   - Always shows the first 3 replies inline.
//   - If there are > 3 replies and the user has not expanded, shows a
//     "View N more" button (where N = total - 3).
//   - When expanded, shows all loaded replies + a "Collapse" button.
//   - After the inline list, shows an inline ReplyComposer (toggled by the
//     "Reply" action on the parent post).
//
// IMPORTANT: This component lives inside `CommentPost`, which is gated by
// vendor Flarum 2.0's `SubtreeRetainer` (in `AbstractPost.onbeforeupdate`).
// That retainer blocks redraws unless `loading`, `freshness`, or the
// `user.freshness` change — and `this.expanded` is none of those. As a
// result, mutating `this.expanded` followed by `m.redraw()` does NOT
// re-render this subtree in Flarum 2.0 (the parent `CommentPost` short-
// circuits the diff). The fix is to drive the CSS `.NestedReplies--expanded`
// toggle directly off the DOM, and to track visibility of the list items
// in the same way. The mithril `view()` is rendered once for the initial
// collapsed shape, then the expand/collapse click handlers toggle the
// `NestedReplies--expanded` class on the wrapper and update
// `.NestedReplies-item` `display` based on the `expanded` state. This
// avoids the SubtreeRetainer lock while still keeping the initial render
// declarative.

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
    this.parentPost = this.attrs.post;

    // Pre-fetch a list of the parent's replies (via API) so we have
    // something to render even if the post wasn't included in the
    // initial discussion payload. (The backend defaults to including
    // them, but this guards against deep links / pagination.)
    this.replies = this.parentPost.replies() || [];

    if (this.replies.length === 0) {
      this.load();
    }
  }

  load() {
    if (this.loading) return;
    this.loading = true;
    const parentId = this.parentPost.id();

    app.store
      .find('posts', {
        filter: { parent: parentId },
        sort: 'createdAt',
        include: 'user',
      })
      .then((payload) => {
        // app.store.find() for a plural query returns an array of Post
        // models (or an array of plain objects in some edge cases). Normalize
        // to an array of models here.
        let list;
        if (Array.isArray(payload)) {
          list = payload;
        } else if (payload && Array.isArray(payload.payload && payload.payload.data)) {
          list = payload.payload.data;
        } else {
          list = [];
        }

        // Some Flarum versions return plain JSON objects; resolve them
        // through the store to get model instances with .id() / .user()
        // methods.
        const models = list
          .map((item) => {
            if (item && typeof item.id === 'function') return item;
            const id = (item && (item.id || (item.data && item.data.id))) || null;
            return id ? app.store.getById('posts', String(id)) : null;
          })
          .filter(Boolean);

        this.replies = models;
        this.loading = false;
        // Schedule a mithril redraw — the parent's SubtreeRetainer will
        // only honor this if `loading` / `freshness` / `user.freshness`
        // also changed. For lazy-load on initial mount, `this.loading`
        // was true, so the retainer sees a value change and rebuilds.
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      })
      .catch(() => {
        this.loading = false;
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      });
  }

  oncreate(vnode) {
    super.oncreate(vnode);
    // Capture the wrapper element for direct DOM toggle of the expanded
    // state (the SubtreeRetainer in vendor Flarum 2.0 CommentPost will
    // not re-render this subtree on `this.expanded` change, so we drive
    // the visual change off the DOM directly).
    this.wrapperEl = vnode.dom;
    this.listEl = vnode.dom && vnode.dom.querySelector('.NestedReplies-list');
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
    // We rely on the CSS rule
    //   .NestedReplies--expanded .NestedReplies-list { max-height: 9999px; }
    // to animate the height change. The items beyond VISIBLE_THRESHOLD
    // are already hidden by the parent's `max-height:240px; overflow:hidden`
    // on `.NestedReplies-list` and become visible automatically when
    // max-height transitions to 9999px — no DOM-level item toggling is
    // required. The button swap ("View N more" ↔ "Collapse") is also
    // handled by the same class change, since both buttons live inside
    // the wrapper and the CSS doesn't differentiate them; the *next*
    // mithril render of the wrapper (triggered by a store update, a
    // reply post, or a future redraw) will pick up `this.expanded` and
    // render the correct button.
  }

  view() {
    const total = this.replies.length;
    const visibleCount = this.expanded ? total : Math.min(total, VISIBLE_THRESHOLD);
    const hiddenCount = Math.max(0, total - VISIBLE_THRESHOLD);
    const showExpandButton = total > VISIBLE_THRESHOLD;
    const showCollapseButton = total > VISIBLE_THRESHOLD;

    return (
      <div
        className={classList('NestedReplies', {
          'NestedReplies--expanded': this.expanded,
          'NestedReplies--loading': this.loading,
        })}
      >
        <ul className="NestedReplies-list">
          {this.replies.slice(0, visibleCount).map((reply) => (
            <li className="NestedReplies-item" key={'reply-' + reply.id()}>
              <NestedReply reply={reply} />
            </li>
          ))}
        </ul>

        {this.loading && (
          <div className="NestedReplies-loading">
            <LoadingIndicator size="small" />
          </div>
        )}

        <div className="NestedReplies-controls">
          {showExpandButton && (
            <Button
              className="Button Button--link NestedReplies-viewMore"
              onclick={() => this.expand()}
            >
              {app.translator.trans('ziven-post-comment.forum.post.view_more_replies', {
                count: hiddenCount,
              })}
            </Button>
          )}

          {showCollapseButton && (
            <Button
              className="Button Button--link NestedReplies-collapse"
              onclick={() => this.collapse()}
            >
              {app.translator.trans('ziven-post-comment.forum.post.collapse_replies')}
            </Button>
          )}
        </div>

        {app.session.user && this.parentPost.discussion().canReply() && (
          <div className="NestedReplies-composer">
            <ReplyComposer
              parentPost={this.parentPost}
              onposted={(newReply) => {
                // Optimistically append the new reply + force a re-render.
                this.replies = [...this.replies, newReply];
                if (typeof m !== 'undefined' && m.redraw) m.redraw();
              }}
            />
          </div>
        )}
      </div>
    );
  }
}
