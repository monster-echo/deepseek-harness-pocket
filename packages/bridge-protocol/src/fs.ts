/**
 * 文件浏览条目（fs.list 返回）：目录与文件都返回，type 区分。
 * 目录选择器只消费 type === 'directory'；产物列表消费文件。
 */
export interface FsEntry {
  readonly name: string
  readonly path: string
  readonly type: 'file' | 'directory'
}
