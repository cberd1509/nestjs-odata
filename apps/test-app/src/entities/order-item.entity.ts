import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm'
import { Order } from './order.entity'
import { Product } from './product.entity'

@Entity()
export class OrderItem {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'int' })
  quantity: number

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  unitPrice: number

  @ManyToOne(() => Order, (order) => order.items)
  order: Order

  @Column()
  orderId: number

  @ManyToOne(() => Product, (product) => product.orderItems)
  product: Product

  @Column()
  productId: number
}
