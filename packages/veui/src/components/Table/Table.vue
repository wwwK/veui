<template>
<div
  v-resize="updateLayout"
  :class="{
    [$c('table')]: true,
    [$c('table-bordered')]: headerBordered || bodyBordered,
    [$c('table-has-bordered-header')]: headerBordered,
    [$c('table-has-bordered-body')]: bodyBordered,
    [$c('table-hit-top')]: hit.top,
    [$c('table-hit-right')]: hit.right,
    [$c('table-hit-bottom')]: hit.bottom,
    [$c('table-hit-left')]: hit.left
  }"
  :ui="realUi"
>
  <div v-show="false">
    <slot/>
  </div>
  <div
    v-if="scrollableY"
    ref="fixedHeader"
    :class="$c('table-fixed-header')"
  >
    <table
      :style="{
        minWidth: scrollableX
          ? `calc(${realScroll.x} + ${gutterWidth}px)`
          : null
      }"
    >
      <col-group gutter/>
      <table-head
        ref="head"
        @sort="sort"
      />
    </table>
  </div>
  <div
    ref="main"
    :class="$c('table-main')"
    :style="{
      maxHeight: scrollableY ? realScroll.y : null
    }"
  >
    <table
      ref="table"
      v-resize="updateLayout"
      :style="{
        minWidth: scrollableX ? realScroll.x : null
      }"
    >
      <col-group/>
      <table-head
        v-if="!scrollableY"
        ref="head"
        @sort="sort"
      />
      <table-body>
        <template slot="no-data">
          <slot name="no-data">{{ t('noData') }}</slot>
        </template>
      </table-body>
      <table-foot
        v-if="!scrollableY && hasFoot"
        ref="foot"
      >
        <slot name="foot"/>
      </table-foot>
    </table>
  </div>
  <div
    v-if="scrollableY && hasFoot"
    ref="fixedFooter"
    :class="$c('table-fixed-footer')"
  >
    <table
      :style="{
        minWidth: scrollableX
          ? `calc(${realScroll.x} + ${gutterWidth}px)`
          : null
      }"
    >
      <col-group gutter/>
      <table-foot ref="foot">
        <slot name="foot"/>
      </table-foot>
    </table>
  </div>
  <div
    v-if="scrollableX"
    aria-hidden="true"
  >
    <div
      v-if="needFixLeft"
      :class="{
        [$c('table-overflow-shadow-left')]: true,
        [$c('table-overflow-shadow-edge')]:
          !hasFixedLeft && !selectable && !expandable
      }"
      :style="{
        width: shadowOffset.left
      }"
    />
    <div
      :class="{
        [$c('table-overflow-shadow-right')]: true,
        [$c('table-overflow-shadow-edge')]: !hasFixedRight
      }"
      :style="{
        width: shadowOffset.right
      }"
    />
  </div>
  <veui-loading
    :class="$c('table-loading')"
    :loading="loading"
    :ui="uiParts.loading"
  >
    {{ t('loading') }}
  </veui-loading>
</div>
</template>

<script>
import warn from '../../utils/warn'
import { normalizeLength } from '../../utils/helper'
import prefix from '../../mixins/prefix'
import ui from '../../mixins/ui'
import i18n from '../../mixins/i18n'
import colgroup from '../../mixins/colgroup'
import useControllable from '../../mixins/controllable'
import resize from '../../directives/resize'
import Loading from '../Loading'
import {
  map,
  mapValues,
  intersection,
  find,
  findIndex,
  findLastIndex,
  omit,
  filter
} from 'lodash'
import Body from './_TableBody'
import Head from './_TableHead'
import Foot from './_TableFoot'
import ColGroup from './_ColGroup'
import '../../common/uiTypes'
import { isEqualSet } from '../../utils/lang'
import { walk } from '../../utils/datasource'
import {
  cssSupports,
  preventBackForward,
  getElementScrollbarWidth
} from '../../utils/dom'

const FIXED_PRIORITY = {
  left: 0,
  false: 1,
  right: 2
}

const DEFAULT_FIXED_COL_WIDTH = 120
const SHADOW_WIDTH = 20

export default {
  name: 'veui-table',
  uiTypes: ['table'],
  components: {
    'table-body': Body,
    'table-head': Head,
    'table-foot': Foot,
    'col-group': ColGroup,
    'veui-loading': Loading
  },
  directives: {
    resize
  },
  mixins: [
    prefix,
    ui,
    i18n,
    colgroup,
    useControllable([
      {
        prop: 'expanded',
        get (val) {
          return normalizeArray(val)
        },
        set (val, commit) {
          let cur = this.isControlled('expanded')
            ? this.expanded
            : this.realExpanded
          if (!isEqualSet(val, cur)) {
            commit(val)
          }
        }
      },
      {
        prop: 'selected',
        get (val) {
          let ctl = this.isControlled('selected')
          if ((ctl && this.validateSelected(this.selected)) || !ctl) {
            val = normalizeArray(val)
            return intersection(val, this.realKeys)
          }
          return []
        },
        set (val, commit) {
          let cur = this.isControlled('selected')
            ? normalizeArray(this.selected)
            : this.realSelected
          if (this.isMultiple) {
            if (!isEqualSet(val, cur)) {
              commit(val)
            }
          } else if (cur[0] !== val[0]) {
            commit(val[0] == null ? null : val[0])
          }
        }
      }
    ])
  ],
  props: {
    data: {
      type: Array,
      default () {
        return []
      }
    },
    scroll: [Number, String, Object],
    keys: [String, Array],
    keyField: String,
    selectable: Boolean,
    expandable: Boolean,
    bordered: Boolean,
    selectMode: {
      type: String,
      default: 'multiple',
      validator (val) {
        return val === 'single' || val === 'multiple'
      }
    },
    /* eslint-disable vue/require-prop-types */
    selected: {
      default () {
        return []
      }
    },
    /* eslint-enable vue/require-prop-types */
    expanded: {
      type: Array,
      default () {
        return []
      }
    },
    order: [Boolean, String],
    orderBy: String,
    allowedOrders: Array,
    columnFilter: Array,
    loading: Boolean
  },
  data () {
    return {
      gutterWidth: 0,
      selectColumnWidth: 0,
      expandColumnWidth: 0,
      overflow: {
        x: false,
        y: false
      },
      hit: {
        top: true,
        right: false,
        left: true,
        bottom: false
      },
      width: null,
      supportSticky: true
    }
  },
  computed: {
    isMultiple () {
      return this.selectMode === 'multiple'
    },
    filteredColumns () {
      return this.filterColumns(this.columns)
    },
    sortedColumns () {
      return this.filteredColumns.sort(
        (col1, col2) => FIXED_PRIORITY[col1.fixed] - FIXED_PRIORITY[col2.fixed]
      )
    },
    realColumns () {
      return this.headerGrid[this.headerGrid.length - 1]
    },
    headerDepth () {
      return getDepth(this.sortedColumns)
    },
    headerGrid () {
      let rows = [...Array(this.headerDepth + 1)].map(() => [])

      walk(
        this.sortedColumns,
        {
          exit: (col, { depth }) => {
            let leaves = getLeaves(col)

            if (col.columns.length === 0) {
              // leaf columns are used to calculate sticky offsets
              let cell = { ...col, width: col.width }
              if (col.fixed) {
                if (!col.width) {
                  cell.width = DEFAULT_FIXED_COL_WIDTH
                  warn(
                    `[veui-table] Lacking specified width for column "${col.field}". Fixed leaf columns must have specified width. Default to \`${DEFAULT_FIXED_COL_WIDTH}\` when not specified and this may change in future versions.`,
                    this
                  )
                }

                let row = rows[depth]
                if (col.fixed === 'left') {
                  cell.offset = sumWidths([
                    this.offsetLeft,
                    ...row.map(({ width }) => width)
                  ])
                }
              }

              let rowspan = this.headerDepth - depth + 1
              cell.rowspan = rowspan

              for (let i = 0; i < rowspan; i++) {
                rows[depth + i].push({
                  ...cell,
                  placeholder: i > 0,
                  first:
                    rows[depth + i].length === 0 &&
                    !this.selectable &&
                    !this.expandable
                })
              }
            } else {
              let row = rows[depth]
              let index = row.length

              let colspan = leaves.length

              for (let i = 0; i < colspan; i++) {
                let cell = {
                  ...col,
                  colspan,
                  width: rows[rows.length - 1][index + i].width,
                  placeholder: i > 0,
                  first:
                    row.length === 0 && !this.selectable && !this.expandable
                }
                if (col.fixed === 'left') {
                  cell.offset = sumWidths([
                    this.offsetLeft,
                    ...row.map(({ width }) => width)
                  ])
                }
                row.push(cell)
              }
            }
          }
        },
        'columns'
      )

      let colCount = rows[0].length
      rows.forEach(row => {
        for (let i = 0; i < colCount; i++) {
          let prev = row[i - 1]
          let cell = row[i]
          let next = row[i + 1]

          if (cell.fixed === 'left') {
            if (next && !next.fixed) {
              cell.edge = true
            }
          } else if (cell.fixed === 'right') {
            let { colspan } = cell
            let rightEdge = i + (colspan > 1 ? colspan - 1 : 0) + 1
            let widths = row.slice(rightEdge).map(({ width }) => width)
            cell.offset = sumWidths(widths.concat(this.gutterWidth))
            cell.bodyOffset = sumWidths(widths)

            if (prev && !prev.fixed) {
              cell.edge = true
            }
          }

          if (i === colCount - 1 && !cell.placeholder) {
            cell.last = true
          }
        }
      })

      return rows
    },
    headerRows () {
      return this.headerGrid.map(row =>
        row.filter(({ placeholder }) => !placeholder)
      )
    },
    shadowOffset () {
      if (!this.supportSticky) {
        return {
          left: SHADOW_WIDTH,
          right: SHADOW_WIDTH
        }
      }
      let row = this.headerGrid[this.headerGrid.length - 1]
      let leftEnd = findLastIndex(row, cell => cell.fixed === 'left')
      let rightStart = findIndex(row, cell => cell.fixed === 'right')
      rightStart = rightStart === -1 ? row.length : rightStart

      // make shadow placeholders at least 20px width because
      // box-shadow will be affected by element size when
      // either width or height is smaller than blur radius
      return {
        left: sumWidths(
          row
            .slice(0, leftEnd + 1)
            .map(({ width }) => width)
            .concat(this.offsetLeft, SHADOW_WIDTH)
        ),
        right: sumWidths(
          row
            .slice(rightStart)
            .map(({ width }) => width)
            .concat(this.hasFixedRight ? this.gutterWidth : [], SHADOW_WIDTH)
        )
      }
    },
    realScroll () {
      let { scroll } = this
      if (typeof scroll === 'number' || typeof scroll === 'string') {
        return {
          y: normalizeLength(scroll)
        }
      }
      return mapValues(scroll || {}, normalizeLength)
    },
    columnWidths () {
      return this.realColumns.map(({ width }) => normalizeLength(width))
    },
    viewColumnCount () {
      return (
        this.realColumns.length +
        (this.selectable ? 1 : 0) +
        (this.expandable ? 1 : 0)
      )
    },
    hasSpan () {
      return this.realColumns.some(({ span }) => span)
    },
    hasFixedLeft () {
      return this.realColumns.some(({ fixed }) => fixed === 'left')
    },
    hasFixedRight () {
      return this.realColumns.some(({ fixed }) => fixed === 'right')
    },
    needFixLeft () {
      return this.scrollableX && (this.hasFixedLeft || this.data.length > 0)
    },
    realBordered () {
      return this.bordered || this.hasSpan
    },
    headerBordered () {
      return this.bordered || this.headerDepth > 0 || this.bodyBordered
    },
    bodyBordered () {
      return this.bordered || this.hasSpan
    },
    realKeys () {
      return this.getKeys(this.data)
    },
    selectedItems () {
      return this.getSpecificItems(this.realSelected)
    },
    enabledData () {
      return filter(this.data, i => i.disabled !== true)
    },
    disabledSelectedKeys () {
      return filter(this.realSelected, key => {
        let items = this.getItems(key)
        return Array.isArray(items)
          ? items.some(i => !!i.disabled)
          : !!(items || {}).disabled
      })
    },
    selectStatus () {
      let keys = this.realKeys
      let inter = this.realSelected
      if (!inter.length) {
        return 'none'
      }
      if (inter.length === keys.length) {
        return 'all'
      }
      return 'partial'
    },
    hasFoot () {
      return (
        this.$scopedSlots.foot ||
        this.$slots.foot ||
        this.filteredColumns.some(col => col.hasFoot())
      )
    },
    scrollableX () {
      return !!this.realScroll.x
    },
    scrollableY () {
      return !!(this.realScroll.y && this.data.length)
    },
    staleHead () {
      return this.realColumns.some(({ hasStaleHead }) => hasStaleHead())
    },
    staleFoot () {
      return this.realColumns.some(({ hasStaleFoot }) => hasStaleFoot())
    },
    offsetLeft () {
      return this.selectColumnWidth + this.expandColumnWidth
    }
  },
  created () {
    if ('keys' in this.$options.propsData) {
      warn(
        '[veui-talbe] The `keys` prop is deprecated and will be removed in v2.0.0. Use `key-field` instead.',
        this
      )
    }
  },
  mounted () {
    this.supportSticky = cssSupports('position', 'sticky')
    ;['scrollableX', 'scrollableY'].forEach(state => {
      this.$watch(
        state,
        () => {
          this.updateScrollListeners()
        },
        { immediate: true }
      )
    })

    if (this.selectable) {
      this.selectColumnWidth = this.$el.querySelector(
        `.${this.$c('table-cell-select')}`
      ).offsetWidth
    }
    if (this.expandable) {
      this.expandColumnWidth = this.$el.querySelector(
        `.${this.$c('table-cell-expand')}`
      ).offsetWidth
    }
  },
  beforeDestroy () {
    this.updateScrollListeners(true)
  },
  updated () {
    if (this.staleHead) {
      this.$refs.head.$forceUpdate()
    }
    if (this.hasFoot && this.staleFoot) {
      this.$refs.foot.$forceUpdate()
    }
  },
  methods: {
    select (selected, index) {
      let item = null
      let value
      if (index !== undefined) {
        item = this.data[index]
        let key = this.getKeyByIndex(index)
        if (selected) {
          value = this.isMultiple ? [...this.realSelected, key] : [key]
        } else {
          value = [...this.realSelected]
          value.splice(value.indexOf(key), 1)
        }
      } else {
        if (
          !selected &&
          intersection(this.realSelected, this.disabledSelectedKeys).length ===
            this.realSelected.length
        ) {
          selected = true
        }
        value = selected
          ? [...this.getKeys(this.enabledData), ...this.disabledSelectedKeys]
          : this.disabledSelectedKeys
      }
      // 先 select 然后 .sync ，有点怪啊，先保留吧
      // 不能直接拿 selectedItems ，因为这个时候 realSelected 还没更新
      this.$emit('select', selected, item, this.getSpecificItems(value))
      this.commit('selected', value)
    },
    getSpecificItems (specific) {
      return specific.reduce((selectedItems, key) => {
        selectedItems[key] = this.getItems(key)
        return selectedItems
      }, {})
    },
    getKeys (data) {
      if (this.keyField) {
        let { span } =
          find(this.realColumns, ({ field }) => field === this.keyField) || {}
        if (typeof span === 'function') {
          return Object.keys(data)
            .map(index => {
              return {
                index,
                span: span(index)
              }
            })
            .filter(({ span: { row = 1, col = 1 } }) => row >= 1 && col >= 1)
            .map(({ index }) => data[index][this.keyField])
        }
        return map(data, this.keyField)
      }
      let keys = this.keys
      if (!keys) {
        keys = Object.keys(data)
      }
      if (typeof keys === 'string') {
        keys = map(data, keys)
      }
      return keys.map(String)
    },
    expand (expanded, index) {
      let key = this.getKeyByIndex(index)
      if (expanded) {
        this.commit('expanded', [...this.realExpanded, key])
      } else {
        let val = [...this.realExpanded]
        val.splice(val.indexOf(key), 1)
        this.commit('expanded', val)
      }
    },
    getKeyByIndex (index) {
      let item = this.data[index]
      return this.keyField ? item[this.keyField] : this.realKeys[index]
    },
    getItems (key) {
      if (this.keyField) {
        let items = this.data.filter(item => item[this.keyField] === key)
        return items.length === 1 ? items[0] : items
      }
      return this.data[this.realKeys.indexOf(key)]
    },
    sort (field, order) {
      this.$emit('sort', field, order)
    },
    validateSelected (val = this.selected) {
      if (this.selectMode === 'single' && Array.isArray(this.selected)) {
        warn(
          '`selected` should not be an array when `select-mode` is `single`.',
          this
        )
        return false
      } else if (
        this.selectMode === 'multiple' &&
        !Array.isArray(this.selected)
      ) {
        warn(
          '`selected` should be an array when `select-mode` is `multiple`.',
          this
        )
        return false
      }
      return true
    },
    updateLayout () {
      let { main, table } = this.$refs
      this.overflow = {
        x: table.offsetWidth > main.clientWidth,
        y: table.offsetHeight > main.clientHeight
      }
      this.gutterWidth = getElementScrollbarWidth(main)
      this.width = main.clientWidth

      this.updateScrollState()
    },
    updateScrollState () {
      let { main, fixedHeader, fixedFooter } = this.$refs

      if (this.scrollableX) {
        this.hit.right = main.scrollLeft + main.clientWidth >= main.scrollWidth
        this.hit.left = main.scrollLeft === 0
      }

      if (this.scrollableY) {
        this.hit.top = main.scrollTop === 0
        this.hit.bottom =
          main.scrollTop + main.clientHeight >= main.scrollHeight
      }

      if (fixedHeader) {
        fixedHeader.scrollLeft = main.scrollLeft
      }

      if (fixedFooter) {
        fixedFooter.scrollLeft = main.scrollLeft
      }
    },
    updateScrollListeners (isDestroy) {
      if ((this.scrollableX || this.scrollableY) && !isDestroy) {
        this.updateLayout()
        this.$refs.main.addEventListener('scroll', this.updateScrollState)
      } else if (isDestroy) {
        this.$refs.main.removeEventListener('scroll', this.updateScrollState)
      } else {
        this.updateLayout()
      }

      if (this.scrollableX && !isDestroy) {
        this.removeBackForwardPreventer = preventBackForward(this.$refs.main)
      } else {
        if (this.removeBackForwardPreventer) {
          this.removeBackForwardPreventer()
        }
      }
    },
    filterColumns (columns) {
      let cols = []
      columns.forEach(col => {
        let c = omit(col, 'columns')
        c.columns = this.filterColumns(col.columns)
        if (
          c.columns.length > 0 ||
          (c.field &&
            (!this.columnFilter || this.columnFilter.indexOf(c.field) !== -1))
        ) {
          cols.push(c)
        }
      })
      return cols
    }
  }
}

function normalizeArray (val) {
  if (val == null) {
    return []
  }

  return Array.isArray(val) ? val : [val]
}

function getLeaves (col) {
  let leaves = []
  walk(
    col.columns,
    column => {
      if (column.columns.length === 0) {
        leaves.push(column)
      }
    },
    'columns'
  )
  return leaves
}

function getDepth (cols) {
  let max = 0
  walk(
    cols,
    (_, { depth }) => {
      if (depth > max) {
        max = depth
      }
    },
    'columns'
  )
  return max
}

function sumWidths (widths) {
  let normalized = widths.map(normalizeLength).filter(w => w)
  return normalized.length === 0
    ? 0
    : normalized.length === 1
      ? normalized[0]
      : `calc(${normalized.join(' + ')})`
}
</script>
