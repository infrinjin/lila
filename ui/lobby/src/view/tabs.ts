import { h } from 'snabbdom';
import { bind, MaybeVNodes } from 'common/snabbdom';
import LobbyController from '../ctrl';
import { Tab } from '../interfaces';

function tab(ctrl: LobbyController, key: Tab, active: Tab, content: MaybeVNodes) {
  return h(
    'span',
    {
      attrs: { role: 'tab' },
      class: { active: key === active, glowing: key !== active && key === 'pools' && !!ctrl.poolMember },
      hook: bind('mousedown', _ => ctrl.setTab(key), ctrl.redraw),
    },
    content,
  );
}

export default function (ctrl: LobbyController) {
  const nbPlaying = ctrl.data.nbNowPlaying,
    myTurnPovsNb = ctrl.data.nowPlaying.filter(p => p.isMyTurn).length,
    active = ctrl.tab,
    isBot = ctrl.me?.isBot;
  return [
    h('div.tabs-horiz', { attrs: { role: 'tablist' } }, [
      isBot ? undefined : tab(ctrl, 'pools', ctrl.tab, [ctrl.trans.noarg('quickPairing')]),
      isBot ? undefined : tab(ctrl, 'custom_games', ctrl.tab, ['Lobby']),
      ctrl.tab === 'now_playing' || nbPlaying || isBot
        ? tab(ctrl, 'now_playing', ctrl.tab, [
            'Games',
            myTurnPovsNb > 0 ? h('i.unread', myTurnPovsNb >= 9 ? '9+' : myTurnPovsNb) : null,
          ])
        : null,
    ]),
    ctrl.tab === 'custom_games'
      ? h('div.tabs-horiz.secondary-tabs', { attrs: { role: 'tablist' } }, [
          tab(ctrl, 'real_time', ctrl.customGameTab, ['Real time']),
          tab(ctrl, 'correspondence', ctrl.customGameTab, ['Correspondence']),
          isBot ? undefined : tab(ctrl, 'pools', active, [ctrl.trans.noarg('quickPairing')]),
        ])
      : null,
  ];
}
