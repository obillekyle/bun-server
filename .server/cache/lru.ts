import { is, assert } from '@server/utils/common'

class LRUNode<K, V> {
  prev: LRUNode<K, V> | null = null
  next: LRUNode<K, V> | null = null
  constructor(
    public key: K,
    public value: V,
  ) {}
}

export class LRUCache<K, V> {
  private map = new Map<K, LRUNode<K, V>>()
  private head: LRUNode<K, V> | null = null
  private tail: LRUNode<K, V> | null = null

  constructor(public readonly maxSize: number) {
    if (maxSize <= 0) {
      throw new Error('LRUCache size must be greater than 0')
    }
  }

  get size(): number {
    return this.map.size
  }

  has(key: K): boolean {
    return this.map.has(key)
  }

  ping(key: K): void {
    const node = this.map.get(key)
    if (node) {
      this.moveToTail(node)
    }
  }

  get(key: K): V | undefined {
    const node = this.map.get(key)
    if (!node) return undefined
    this.moveToTail(node)
    return node.value
  }

  getOrInsert(key: K, val: V): V {
    return this.getOrInsertComputed(key, () => val)
  }

  getOrInsertComputed(key: K, compute: () => V): V {
    const node = this.map.get(key)
    if (node) {
      this.moveToTail(node)
      return node.value
    }
    return this.insertNode(key, compute()).value
  }

  set(key: K, value: V): this {
    const node = this.map.get(key)
    if (node) {
      node.value = value
      this.moveToTail(node)
      return this
    }
    this.insertNode(key, value)
    return this
  }

  delete(key: K): boolean {
    const node = this.map.get(key)
    if (!node) return false
    this.remove(node)
    this.map.delete(key)
    return true
  }

  clear(): void {
    this.map.clear()
    this.head = null
    this.tail = null
  }

  private moveToTail(node: LRUNode<K, V>): void {
    if (node === this.tail) return
    this.remove(node)
    this.append(node)
  }

  private insertNode(key: K, value: V): LRUNode<K, V> {
    if (this.map.size >= this.maxSize) {
      this.evict()
    }
    const node = new LRUNode(key, value)
    this.map.set(key, node)
    this.append(node)
    return node
  }

  private append(node: LRUNode<K, V>): void {
    if (!this.head) {
      this.head = node
      this.tail = node
    } else {
      assert(this.tail)
      this.tail.next = node
      node.prev = this.tail
      this.tail = node
    }
  }

  private remove(node: LRUNode<K, V>): void {
    if (node.prev) {
      node.prev.next = node.next
    } else {
      this.head = node.next
    }
    if (node.next) {
      node.next.prev = node.prev
    } else {
      this.tail = node.prev
    }
    node.prev = null
    node.next = null
  }

  private evict(): void {
    if (!this.head) return
    this.map.delete(this.head.key)
    this.remove(this.head)
  }

  *keys(): IterableIterator<K> {
    let curr = this.head
    while (curr) {
      yield curr.key
      curr = curr.next
    }
  }

  *values(): IterableIterator<V> {
    let curr = this.head
    while (curr) {
      yield curr.value
      curr = curr.next
    }
  }

  *entries(): IterableIterator<[K, V]> {
    let curr = this.head
    while (curr) {
      yield [curr.key, curr.value]
      curr = curr.next
    }
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries()
  }
}
