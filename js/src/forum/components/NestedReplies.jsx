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
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      })
      .catch(() => {
        this.loading = false;
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      });
  }

  expand() {
    this.expanded = true;
    // Use rAF + m.redraw to push the state change through mithril's render
    // cycle (works around timing issues when the click comes from a
    // `m(Button)` child whose handler runs inside mithril's own redraw).
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => {
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      });
    }
  }

  collapse() {
    this.expanded = false;
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => {
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
      });
    }
  }

  view() {
    const total = this.replies.length;
    const visibleCount = this.expanded ? total : Math.min(total, VISIBLE_THRESHOLD);
    const hiddenCount = Math.max(0, total - VISIBLE_THRESHOLD);
    const showExpandButton = total > VISIBLE_THRESHOLD && !this.expanded;
    const showCollapseButton = this.expanded && total > VISIBLE_THRESHOLD;

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
                m.redraw();
              }}
            />
          </div>
        )}
      </div>
    );
  }
}
