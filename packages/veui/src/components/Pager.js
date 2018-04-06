import Pagination from './Pagination'
import warn from '../utils/warn'

/**
 * @deprecated Use Pagination instead
 */
export default {
  ...Pagination,
  created () {
    warn('[veui-pager] `Pager` is deprecated and will be removed in the next version. Use `Pagination` component instead.')
  }
}
