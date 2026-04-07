import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany } from 'typeorm'
import { Customer } from './customer.entity'
import { OrderItem } from './order-item.entity'

@Entity()
export class Order {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'datetime' })
  orderDate: Date

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalAmount: number

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  status: string

  @ManyToOne(() => Customer, (customer) => customer.orders)
  customer: Customer

  @Column()
  customerId: number

  @OneToMany(() => OrderItem, (orderItem) => orderItem.order)
  items: OrderItem[]
}
