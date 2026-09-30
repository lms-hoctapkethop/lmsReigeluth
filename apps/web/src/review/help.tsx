import { Link } from 'react-router'
import styles from './desk.module.css'

export function ReviewKeysHelp() {
  return (
    <section className={styles.stack}>
      <h1>Phím tắt bàn chấm</h1>
      <ul>
        <li><kbd>1</kbd> Đạt</li>
        <li><kbd>2</kbd> Đang phát triển</li>
        <li><kbd>3</kbd> Chưa đạt</li>
        <li><kbd>4</kbd> Chưa thể hiện</li>
        <li><kbd>J</kbd> tiêu chí tiếp theo</li>
        <li><kbd>K</kbd> tiêu chí trước</li>
      </ul>
      <p>Phím tắt không chạy khi con trỏ đang ở ô nhập.</p>
      <p><Link to="/day">Về lớp đang dạy</Link></p>
    </section>
  )
}
