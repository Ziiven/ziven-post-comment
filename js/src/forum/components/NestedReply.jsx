// NestedReply — renders a single nested reply (a child CommentPost shown
// in compact form, with a blue left border + smaller avatar).
//
// `m` is the global mithril (provided by Flarum core, configured via
// flarum-webpack-config's babel JSX pragma). We use `m.trust()` to render
// server-produced HTML — see https://mithril.js.org/trust.html. The
// previous version used React's `dangerouslySetInnerHTML` which is a no-op
// under the mithril JSX pragma and caused empty reply content.
//
// v0.1.0e.a design (辉哥拍板 2026-08-19 16:24, 撤回 v0.1.0e 的 A2 无限层):
//   - SINGLE-LEVEL: a NestedReply does NOT render a NestedReplies
//     underneath itself. Only top-level posts host a NestedReplies
//     block. (WeChat 朋友圈 / 小黑盒 / 知乎 / 微博 all use 1-level
//     nested replies — the v0.1.0e 5-level infinite nesting was
//     wrong.)
//   - REPLYING: clicking the NestedReply card opens the **vendor
//     Flarum 2.0 composer** via
//     `app.composer.load(NestedReplyComposer, { parentPost: this reply })`.
//     NOT a zpc inline composer, NOT a recursive NestedReplies
//     underneath.
//   - The card-click exclusion list is also tightened (B2 in
//     辉哥's task): the click now ignores `.Post-header` (the entire
//     vendor header area — username / time / avatar / role badge)
//     in addition to the previous `.Post-actions`, links, child
//     elements. The user must click `.NestedReply-content` (the
//     post body) to trigger the reply composer.

import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import Avatar from 'flarum/common/components/Avatar';
import Link from 'flarum/common/components/Link';
import classList from 'flarum/common/utils/classList';

import NestedReplyComposer from './NestedReplyComposer';

export default class NestedReply extends Component {
  oninit(vnode) {
    super.oninit(vnode);
  }

  oncreate(vnode) {
    super.oncreate(vnode);

    // v0.1.0e: capture the article element and bind a native click
    // listener. Native (not mithril JSX `onclick`) because vendor
    // Flarum 2.0's `SubtreeRetainer` (in `AbstractPost.onbeforeupdate`)
    // blocks re-renders of this subtree, which would orphan any
    // mithril-attached click handler the next time the parent
    // `CommentPost` re-renders. SOP 207 / 208 pattern.
    this.articleEl = vnode.dom;

    if (this.articleEl && !this.articleEl.dataset.zpcClickBound) {
      this.articleEl.dataset.zpcClickBound = '1';
      this._onCardClick = (e) => this._handleCardClick(e);
      this.articleEl.addEventListener('click', this._onCardClick);
    }
  }

  onremove(vnode) {
    // Clean up the native listener so we don't leak handlers when
    // the post list re-renders.
    if (this.articleEl && this._onCardClick) {
      this.articleEl.removeEventListener('click', this._onCardClick);
      delete this.articleEl.dataset.zpcClickBound;
    }
    super.onremove(vnode);
  }

  /**
   * v0.1.0e.a: handle a click anywhere on the NestedReply card.
   * The goal is to open the vendor Flarum 2.0 reply composer
   * (NestedReplyComposer wraps vendor ReplyComposer) with
   * `parentPost` set to this NestedReply's post. The user can
   * still click links / vendor actions without triggering the
   * composer.
   *
   * Exclusion list (B2, 辉哥 task):
   *   1. The click is on a link (`a[href]`) — let the browser
   *      navigate. Catches username, time, etc.
   *   2. The click is inside a vendor `Post-actions` region (e.g.
   *      the Like button) — vendor has its own click semantics.
   *   3. The click is inside a vendor `Post-header` region (NEW
   *      in v0.1.0e.a, B2 辉哥拍板). Catches the entire vendor
   *      header — username link, time link, avatar, role
   *      badges. The user must click `.Post-body` / `.NestedReply
   *      -content` (the post body) to trigger the reply
   *      composer. (Previously the header was clickable; v0.1.0e.a
   *      tightens this because the header is a navigation area,
   *      not a "click to reply" affordance.)
   *   4. The click is inside a child `NestedReply-replies` (defensive,
   *      even though v0.1.0e.a no longer renders a NestedReplies
   *      under each NestedReply).
   *
   * If none of the above match, we open the vendor
   * NestedReplyComposer with `parentPost` set to this reply's
   * post. `app.composer.load` is idempotent — if a composer is
   * already open for this parentPost, it will be re-loaded (the
   * user gets a fresh composer).
   */
  _handleCardClick(e) {
    if (!e || !e.target) return;
    const t = e.target;

    // 1. Links — username / time / vendor action links must
    //    still navigate. We do NOT call `e.preventDefault()` /
    //    `e.stopPropagation()` because mithril's `Link` component
    //    relies on the browser's native navigation.
    if (t.closest && t.closest('a[href]')) {
      return;
    }

    // 2. Vendor Post-actions (Like button, vendor Reply button,
    //    etc.). Vendor has its own click semantics on its child
    //    buttons, and we want them to keep working.
    if (t.closest && t.closest('.Post-actions')) {
      return;
    }

    // 3. Vendor Post-header (B2 辉哥拍板, v0.1.0e.a NEW) — the
    //    entire header area (username link, time link, avatar,
    //    role badge) is a navigation area, not a "click to
    //    reply" affordance. Excluding it means clicks on the
    //    header do nothing (vendor default for the header
    //    links/avatars is to navigate or show user card).
    if (t.closest && t.closest('.Post-header')) {
      return;
    }

    // 4. Defensive: if a child NestedReply-replies somehow exists
    //    (shouldn't, in v0.1.0e.a, but keep the guard), let the
    //    child handle its own clicks.
    if (t.closest && t.closest('.NestedReply-replies')) {
      return;
    }

    e.stopPropagation();
    e.preventDefault();

    // Pass `discussion` alongside `parentPost` so the vendor
    // ReplyComposer (which is a *Discussion-level* composer)
    // has the discussion it needs for its data() payload.
    // Our `extend()`-override of `data()` adds `parentPost`
    // to the relationships on top of the vendor's existing
    // `discussion`.
    //
    // We do NOT gate on `app.session.user` / `canReply()` here
    // for the same reason as in index.js's CommentPost card
    // handler — vendor's own load will refuse to load if the
    // user can't reply, and gating on those conditions
    // client-side actually *breaks* the click in real-world
    // cases. Vendor's check is the source of truth.
    app.composer.load(NestedReplyComposer, {
      parentPost: this.attrs.reply,
      discussion: this.attrs.reply.discussion(),
    }).then(() => {
      if (!app.composer.isVisible()) {
        return app.composer.show();
      }
    });
  }

  view() {
    const reply = this.attrs.reply;
    const user = reply.user();
    const discussion = reply.discussion();

    if (!user || !discussion) {
      return <div className="NestedReply NestedReply--missing">Reply #{reply.id()}</div>;
    }

    return (
      <article
        className={classList('NestedReply', {
          'NestedReply--hidden': reply.isHidden(),
        })}
      >
        <div className="NestedReply-avatar">
          <Link href={app.route.user(user)}>
            <Avatar user={user} className="NestedReply-avatar-img" />
          </Link>
        </div>

        <div className="NestedReply-body">
          <header className="NestedReply-header">
            <Link className="NestedReply-author" href={app.route.user(user)}>
              {user.displayName()}
            </Link>
            <a
              className="NestedReply-time"
              href={app.route.post(reply)}
              title={reply.createdAt().toLocaleString()}
            >
              {reply.createdAt().toLocaleString()}
            </a>
          </header>

          <div className="NestedReply-content">
            {m.trust(reply.contentHtml() || '')}
          </div>
        </div>

        {/* v0.1.0e.a: no NestedReplies underneath (单层). The previous
            v0.1.0e rendered a recursive <NestedReplies post={reply} />
            here; we removed it. (WeChat 朋友圈 / 小黑盒 / 知乎 /
            微博 all use 1-level nested replies.) */}
      </article>
    );
  }
}
