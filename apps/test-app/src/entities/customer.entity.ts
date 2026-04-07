import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm'
import { Order } from './order.entity'

@Entity()
export class Customer {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 255 })
  firstName: string

  @Column({ type: 'varchar', length: 255 })
  lastName: string

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string

  @OneToMany(() => Order, (order) => order.customer)
  orders: Order[]
}
