import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  ManyToMany,
  JoinTable,
  UpdateDateColumn,
} from 'typeorm'
import { Category } from './category.entity'
import { OrderItem } from './order-item.entity'
import { Tag } from './tag.entity'

@Entity()
export class Product {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 255 })
  name: string

  @Column({ type: 'text', nullable: true })
  description: string | null

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number

  @Column({ type: 'boolean', default: true })
  active: boolean

  @Column({ type: 'datetime' })
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date

  @ManyToOne(() => Category, (category) => category.products)
  category: Category

  @Column({ nullable: true })
  categoryId: number | null

  @OneToMany(() => OrderItem, (orderItem) => orderItem.product)
  orderItems: OrderItem[]

  @ManyToMany(() => Tag, (tag) => tag.products)
  @JoinTable()
  tags: Tag[]
}
