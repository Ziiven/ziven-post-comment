// NestedReply — renders a single nested reply (a child CommentPost shown
// in compact form, with a blue left border + smaller avatar).
//
// `m` is the global mithril (provided by Flarum core, configured via
// flarum-webpack-config's babel JSX pragma). We use `m.trust()` to render
// server-produced HTML — see https://mithril.js.org/trust.html. The
// previous version used React's `dangerouslySetInnerHTML` which is a no-op
// under the mithril JSX pragma and caused empty reply content.

import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import Avatar from 'flarum/common/components/Avatar';
import Link from 'flarum/common/components/Link';
import classList from 'flarum/common/utils/classList';

export default class NestedReply extends Component {
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
      </article>
    );
  }
}
