// NestedReply — renders a single nested reply (a child CommentPost shown
// in compact form, with a blue left border + smaller avatar).
//
// `m` is the global mithril (provided by Flarum core, configured via
// flarum-webpack-config's babel JSX pragma). We use `m.trust()` to render
// server-produced HTML — see https://mithril.js.org/trust.html. The
// previous version used React's `dangerouslySetInnerHTML` which is a no-op
// under the mithril JSX pragma and caused empty reply content.
//
// v0.1.0e: the card is now fully clickable to open the nested reply
// composer for THIS reply (a 小黑盒-style "click anywhere on the
// reply card to reply" UX). The reply's own replies (nested
// further) are also rendered recursively — a reply of a reply can
// itself be replied to, and so on, infinitely (up to the
// `addDefaultInclude` depth on the server, currently 5). The
// click-handler exclusion list lets links (username, time, vendor
// actions) keep their native behaviour without triggering the
// reply-composer toggle.

import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import Avatar from 'flarum/common/components/Avatar';
import Link from 'flarum/common/components/Link';
import classList from 'flarum/common/utils/classList';

import NestedReplies from './NestedReplies';

export default class NestedReply extends Component {
  oninit(vnode) {
    super.oninit(vnode);
    // No state needed for now — the article's click handler delegates
    // to the nearest inner NestedReplies (or to the component's own
    // public method if no NestedReplies is rendered). v0.1.0e
    // doesn't keep any per-instance state on NestedReply itself; the
    // "open / closed" state of the composer lives on the inner
    // NestedReplies instance.
  }

  oncreate(vnode) {
    super.oncreate(vnode);

    // v0.1.0e: capture the article element and bind a native click
    // listener. Native (not mithril JSX `onclick`) because vendor
    // Flarum 2.0's `SubtreeRetainer` (in `AbstractPost.onbeforeupdate`)
    // blocks re-renders of this subtree, which would orphan any
    // mithril-attached click handler the next time the parent
    // `CommentPost` re-renders. SOP 207 / 208 pattern. See the file
    // header for the rationale.
    this.articleEl = vnode.dom;

    if (this.articleEl && !this.articleEl.dataset.zpcClickBound) {
      this.articleEl.dataset.zpcClickBound = '1';
      this._onCardClick = (e) => this._handleCardClick(e);
      this.articleEl.addEventListener('click', this._onCardClick);
    }
  }

  onremove(vnode) {
    // Clean up the native listener so we don't leak handlers when
    // the post list re-renders. SubtreeRetainer makes this less of
    // a concern in steady state, but `DiscussionPage` does
    // occasionally rebuild the post subtree (e.g. on
    // discussion merge), and a leak there is a real concern.
    if (this.articleEl && this._onCardClick) {
      this.articleEl.removeEventListener('click', this._onCardClick);
      delete this.articleEl.dataset.zpcClickBound;
    }
    super.onremove(vnode);
  }

  /**
   * v0.1.0e: handle a click anywhere on the reply card. The goal is
   * to open the nested reply composer for THIS reply (a 小黑盒-style
   * "click anywhere on the reply to reply" UX), but to let the user
   * still click links (username, time, vendor actions) without
   * triggering the composer toggle.
   *
   * Exclusion list (in order of priority — first match wins):
   *   1. The click is on a link (`a[href]`) or any descendant of a
   *      link — let the browser handle navigation. Catches the
   *      username link, the time link, and any vendor actions
   *      link.
   *   2. The click is inside a vendor `Post-actions` region (e.g.
   *      the Like button or vendor Reply button) — the vendor has
   *      its own click semantics and we must not preempt it.
   *   3. The click is inside a child `NestedReplies` element (i.e.
   *      the user is clicking an even-deeper reply card, which has
   *      its OWN card-click handler) — let the inner card handle
   *      it. We use `stopPropagation()` in the child handler
   //      (below) so this is technically a defensive check.
   *   4. The click is inside the composer itself (e.g. typing in
   *      the textarea) — let the composer handle its own clicks.
   *
   * If none of the above match, we toggle the nearest inner
   * `NestedReplies`'s composer (opening it if hidden, closing if
   * already open — `toggleComposer()` semantics). If there's no
   * inner `NestedReplies` yet (the reply has no replies of its
   * own), we open this NestedReplies's composer directly via the
   * same DOM lookup — the function falls through to the parent
   * `NestedReplies` if no inner one exists.
   */
  _handleCardClick(e) {
    if (!e || !e.target) return;
    const t = e.target;

    // 1. Links — including vendor action items rendered as
    //    anchors, our own username / time links, etc. We do NOT
    //    call `e.preventDefault()` / `e.stopPropagation()` because
    //    mithril's `Link` component relies on the browser's native
    //    navigation, and stopping propagation here would break
    //    that.
    if (t.closest && t.closest('a[href]')) {
      return;
    }

    // 2. Vendor Post-actions (Like button, vendor Reply button,
    //    etc.). We exclude the entire `Post-actions` aside — the
    //    vendor has its own click semantics on its child buttons,
    //    and we want them to keep working.
    if (t.closest && t.closest('.Post-actions')) {
      return;
    }

    // 3. Child NestedReply (an even-deeper reply card nested
    //    inside this one). The child has its own click handler
    //    bound to its own article element, and the child handler
    //    calls `e.stopPropagation()` on its own click event. We
    //    bail out if the click target is INSIDE a child
    //    NestedReply — the child handler is the right one to
    //    fire.
    //
    //    CRITICAL: we do NOT bail out if `closest('.NestedReply')`
    //    is our own article (`this.articleEl`) — that case is the
    //    click we're trying to handle! This is the difference
    //    between v0.1.0e and a naive implementation that excludes
    //    ".NestedReply" entirely: the naive version would also
    //    exclude clicks on the body / header / content of our own
    //    card, and the composer would never open.
    if (t.closest && t.closest('.NestedReply')) {
      const closestNestedReply = t.closest('.NestedReply');
      if (closestNestedReply !== this.articleEl) {
        return; // click was on a child NestedReply
      }
      // else: closest is our own article — fall through and
      // handle the click below.
    }

    // 4. Child NestedReplies container — a click on the wrapper
    //    itself (its padding / border / empty padding areas) is
    //    unusual. We bail to avoid weirdness. Clicks on actual
    //    child NestedReply articles are already handled by item 3.
    if (t.closest && t.closest('.NestedReply-replies .NestedReplies')) {
      return;
    }

    // 5. The composer itself — let it handle its own clicks
    //    (text selection, button presses, etc.).
    if (t.closest && t.closest('.NestedReplies-composer, .ReplyComposer')) {
      return;
    }

    // 6. View more / Collapse controls — they are buttons with
    //    their own onclick; we don't want to also fire the
    //    composer toggle. (They live in the .NestedReplies of
    //    this reply's children, but a reply with > 3 children
    //    might have them in view; this is defensive.)
    if (t.closest && t.closest('.NestedReplies-controls')) {
      return;
    }

    // ---- Open the composer ----
    // The article might or might not have an inner NestedReplies
    // (it does iff this reply has replies of its own). Look for
    // the nearest NestedReplies in our own DOM (NOT in the
    // parent's — we don't want to open the parent's composer by
    // clicking a child card).
    //
    // We scope the lookup to descendants of this article, then
    // fall back to the nearest ancestor NestedReplies if no
    // descendant exists.
    let target = null;
    if (this.articleEl) {
      target = this.articleEl.querySelector('.NestedReplies');
    }
    if (!target) {
      // No descendant NestedReplies — find the nearest ancestor
      // NestedReplies (this is the one that holds OUR composer).
      // In practice this is the parent NestedReplies component
      // that rendered us.
      let cur = this.articleEl && this.articleEl.parentElement;
      while (cur) {
        if (cur.classList && cur.classList.contains('NestedReplies')) {
          target = cur;
          break;
        }
        cur = cur.parentElement;
      }
    }

    if (!target) {
      return;
    }

    // Find the mithril instance associated with the target DOM
    // node and call its public `toggleComposer()` method. We
    // stash the mithril component reference on the DOM node in
    // `NestedReplies.oncreate` — see that file's
    // `oncreate(vnode)` for the assignment.
    const inst = target._zpcInstance || target.__zpcNestedReplies;
    if (inst && typeof inst.toggleComposer === 'function') {
      inst.toggleComposer();
      // Prevent the click from also triggering any other listener
      // (e.g. the parent CommentPost's card-click handler — we
      // want only the deepest card to react).
      e.stopPropagation();
    }
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
          'NestedReply--hasNestedReplies': reply.repliesCount() > 0,
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

        {/* v0.1.0e: recursively render this reply's own replies.
            Up to 5 levels of nesting are pre-included by the server
            (see extend.php addDefaultInclude). Levels beyond 5
            would render as missing (the user can still post a
            reply — the API will create it — but the nested
            NestedReplies will show "no replies yet" until the
            next discussion reload). */}
        <div className="NestedReply-replies">
          <NestedReplies post={reply} />
        </div>
      </article>
    );
  }
}
