import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm'
import { Product } from './product.entity'

@Entity()
export class Category {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 100 })
  name: string

  @OneToMany(() => Product, (product) => product.category)
  products: Product[]
}
