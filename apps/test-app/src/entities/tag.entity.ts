import { Entity, PrimaryGeneratedColumn, Column, ManyToMany } from 'typeorm'
import { Product } from './product.entity'

@Entity()
export class Tag {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 100, unique: true })
  name: string

  @ManyToMany(() => Product, (product) => product.tags)
  products: Product[]
}
