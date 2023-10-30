import { h, VNode } from 'snabbdom';
import { ParentCtrl } from '../types';
import { rangeConfig } from 'common/controls';
import { hasFeature } from 'common/device';
import { onInsert, bind } from 'common/snabbdom';
import { onClickAway } from 'common';

const searchTicks: [number, string][] = [
  [4000, '4s'],
  [8000, '8s'],
  [30000, '30s'],
  [300000, '5m'],
  [3600000, '1hr'],
  [Number.POSITIVE_INFINITY, '∞'],
];

const formatHashSize = (v: number): string => (v < 1000 ? v + 'MB' : Math.round(v / 1024) + 'GB');

export function renderCevalSettings(ctrl: ParentCtrl): VNode | null {
  const ceval = ctrl.getCeval(),
    noarg = ctrl.trans.noarg,
    engCtrl = ctrl.getCeval().engines;
  return ceval.showEnginePrefs()
    ? h(
        'div#ceval-settings-anchor',
        h(
          'div#ceval-settings',
          {
            hook: onInsert(
              onClickAway(() => {
                ceval.showEnginePrefs(false);
                ceval.opts.redraw();
              }),
            ),
          },
          [
            engineSelection(ctrl),
            h('hr'),
            (id => {
              return h(
                'div.setting',
                {
                  attrs: { title: 'Set time to evaluate fresh positions' },
                },
                [
                  h('label', noarg('Search')),
                  h('input#' + id, {
                    attrs: { type: 'range', min: 0, max: searchTicks.length - 1, step: 1 },
                    hook: rangeConfig(getSearchPip, n => {
                      ceval.searchMs(searchTicks[n][0]);
                      ctrl.cevalReset?.();
                    }),
                  }),
                  h('div.range_value', searchTicks[getSearchPip()][1]),
                ],
              );
            })('engine-search-ms'),
            (id => {
              const max = 5;
              return h(
                'div.setting',
                {
                  attrs: {
                    title: 'Set number of lines atop the move list in addition to move arrows on the board',
                  },
                },
                [
                  h('label', { attrs: { for: id } }, noarg('multipleLines')),
                  h('input#' + id, {
                    attrs: { type: 'range', min: 0, max, step: 1 },
                    hook: rangeConfig(() => ceval!.multiPv(), ctrl.cevalSetMultiPv ?? (() => {})),
                  }),
                  h('div.range_value', ceval.multiPv() + ' / ' + max),
                ],
              );
            })('analyse-multipv'),
            hasFeature('sharedMem')
              ? (id => {
                  return h(
                    'div.setting',
                    {
                      attrs: {
                        title: 'Higher values improve performance, but other apps may run slower',
                      },
                    },
                    [
                      h('label', { attrs: { for: id } }, noarg('cpus')),
                      h('input#' + id, {
                        attrs: {
                          type: 'range',
                          min: 1,
                          max: ceval.maxThreads(),
                          step: 1,
                          disabled: ceval.maxThreads() <= 1,
                        },
                        hook: rangeConfig(
                          () => ceval.threads(),
                          x => (ceval.setThreads(x), ctrl.cevalReset?.()),
                        ),
                      }),
                      h('div.range_value', `${ceval.threads ? ceval.threads() : 1} / ${ceval.maxThreads()}`),
                    ],
                  );
                })('analyse-threads')
              : null,
            (id =>
              h(
                'div.setting',
                {
                  attrs: {
                    title: 'Higher values improve performance, but can be unstable on mobile',
                  },
                },
                [
                  h('label', { attrs: { for: id } }, noarg('memory')),
                  h('input#' + id, {
                    attrs: {
                      type: 'range',
                      min: 4,
                      max: Math.floor(Math.log2(engCtrl.active?.maxHash ?? 4)),
                      step: 1,
                      disabled: ceval.maxHash() <= 16,
                    },
                    hook: rangeConfig(
                      () => Math.floor(Math.log2(ceval.hashSize())),
                      v => (ceval.setHashSize(Math.pow(2, v)), ctrl.cevalReset?.()),
                    ),
                  }),
                  h('div.range_value', formatHashSize(ceval.hashSize())),
                ],
              ))('analyse-memory'),
          ],
        ),
      )
    : null;
  function getSearchPip() {
    const ms = ceval.searchMs();
    return Math.max(
      0,
      searchTicks.findIndex(([v]) => v >= ms),
    );
  }
}

function engineSelection(ctrl: ParentCtrl) {
  const ceval = ctrl.getCeval(),
    active = ceval.engines.active,
    engines = ceval.engines.supporting(ceval.opts.variant.key);
  if (!engines?.length || !ceval.possible || !ceval.allowed()) return null;
  return h('div.setting', [
    'Engine:',
    h(
      'select.select-engine',
      {
        hook: bind('change', e => {
          ctrl.getCeval().engines.select((e.target as HTMLSelectElement).value);
          lichess.reload();
        }),
      },
      [
        ...engines.map(engine =>
          h(
            'option',
            {
              attrs: {
                value: engine.id,
                selected: active?.id == engine.id,
              },
            },
            engine.name,
          ),
        ),
      ],
    ),
  ]);
}
