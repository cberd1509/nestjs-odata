import {
  Column,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm'

@Entity()
export class Category {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 100 })
  name: string

  @OneToMany(() => Product, (product) => product.category)
  products: Relation<Product[]>
}

@Entity()
export class Product {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 255 })
  name: string

  @Column({ type: 'integer' })
  price: number

  @Column({ type: 'integer', nullable: true })
  categoryId: number | null

  @ManyToOne(() => Category, (category) => category.products)
  category: Relation<Category>
}
