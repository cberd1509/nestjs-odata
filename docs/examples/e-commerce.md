# E-Commerce Example

A complete e-commerce data model with multiple related entities, navigation properties, and advanced OData query patterns. This example is based on the test application shipped with the repository (`apps/test-app/`).

## Data model

Six entities connected through one-to-many and many-to-many relations:

```
Customer 1──* Order 1──* OrderItem *──1 Product *──1 Category
                                       Product *──* Tag
```

## Entities

### Category

```typescript
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
```

### Tag

```typescript
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
```

### Product

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  ManyToMany,
  JoinTable,
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
```

### Customer

```typescript
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
```

### Order

```typescript
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
```

### OrderItem

```typescript
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
```

## Controller

The `ProductsController` wires all CRUD operations through `TypeOrmAutoHandler`:

```typescript
import { Body, Get, Header, Headers, Param, Req } from '@nestjs/common'
import {
  ODataController,
  ODataGet,
  ODataGetByKey,
  ODataPost,
  ODataPatch,
  ODataDelete,
  ODataQueryParam,
  type ODataQuery,
} from '@nestjs-odata/core'
import { TypeOrmAutoHandler } from '@nestjs-odata/typeorm'

@ODataController('Products')
export class ProductsController {
  constructor(private readonly handler: TypeOrmAutoHandler) {}

  @ODataGet('Products', { path: '' })
  async getProducts(
    @ODataQueryParam('Products') query: ODataQuery,
    @Req() req: { originalUrl: string },
  ) {
    return this.handler.handleGet(query, req.originalUrl)
  }

  @Get('$count')
  @Header('Content-Type', 'text/plain')
  async count(@ODataQueryParam('Products') query: ODataQuery): Promise<number> {
    return this.handler.handleCount(query)
  }

  @ODataGetByKey('Products')
  async getProduct(@Param('key') key: string, @Headers('if-none-match') ifNoneMatch?: string) {
    return this.handler.handleGetByKey(key, 'Products', ifNoneMatch)
  }

  @ODataPost('Products')
  async createProduct(@Body() body: Record<string, unknown>) {
    return this.handler.handleCreate(body, 'Products')
  }

  @ODataPatch('Products')
  async updateProduct(
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.handler.handleUpdate(key, body, 'Products', ifMatch)
  }

  @ODataDelete('Products')
  async deleteProduct(@Param('key') key: string, @Headers('if-match') ifMatch?: string) {
    return this.handler.handleDelete(key, 'Products', ifMatch)
  }
}
```

You would follow the same pattern for `OrdersController`, `CustomersController`, etc., changing the entity set name in each decorator.

## Feature module

```typescript
import { Module } from '@nestjs/common'
import { ODataTypeOrmModule } from '@nestjs-odata/typeorm'
import { Product } from '../entities/product.entity'
import { ProductsController } from './products.controller'

@Module({
  imports: [ODataTypeOrmModule.forFeature([Product])],
  controllers: [ProductsController],
})
export class ProductsModule {}
```

## App module

Register all entities together at the root level. `ODataTypeOrmModule.forFeature` auto-derives the EDM from TypeORM metadata -- no double-declaration needed:

```typescript
import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ODataModule } from '@nestjs-odata/core'
import { ODataTypeOrmModule } from '@nestjs-odata/typeorm'
import { Product, Category, Customer, Order, OrderItem, Tag } from './entities'
import { ProductsController } from './products/products.controller'
import { ProductsModule } from './products/products.module'

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Product, Category, Customer, Order, OrderItem, Tag],
      synchronize: true,
    }),
    ODataModule.forRoot({
      serviceRoot: '/odata',
      namespace: 'Default',
      controllers: [ProductsController],
    }),
    ODataTypeOrmModule.forFeature([Product, Category, Customer, Order, OrderItem, Tag]),
    ProductsModule,
  ],
})
export class AppModule {}
```

## Query examples

### Expanding relations

Expand a single navigation property:

```bash
# Products with their category
curl 'http://localhost:3000/odata/Products?$expand=category'
```

Expand nested relations (depth limited by `maxExpandDepth`, default 2):

```bash
# Orders with their items, and each item's product
curl 'http://localhost:3000/odata/Orders?$expand=items($expand=product)'
```

Expand multiple properties at the same level:

```bash
# Orders with customer AND items
curl 'http://localhost:3000/odata/Orders?$expand=customer,items'

# Products with category AND tags (many-to-many)
curl 'http://localhost:3000/odata/Products?$expand=category,tags'
```

### Filtering

Filter by primitive properties:

```bash
# Active products under $50
curl 'http://localhost:3000/odata/Products?$filter=active eq true and price lt 50'

# Orders placed in 2025 with status "shipped"
curl 'http://localhost:3000/odata/Orders?$filter=status eq '\''shipped'\'' and year(orderDate) eq 2025'
```

Filter with string functions:

```bash
# Products whose name contains "Widget"
curl 'http://localhost:3000/odata/Products?$filter=contains(name,'\''Widget'\'')'

# Products whose name starts with "Pro"
curl 'http://localhost:3000/odata/Products?$filter=startswith(name,'\''Pro'\'')'
```

Filter with navigation property lambda operators:

```bash
# Categories that have at least one product priced over $100
curl 'http://localhost:3000/odata/Categories?$filter=products/any(p:p/price gt 100)'

# Orders where ALL items have quantity >= 2
curl 'http://localhost:3000/odata/Orders?$filter=items/all(i:i/quantity ge 2)'
```

### Combining query options

```bash
# Top 10 most expensive active products with category info, sorted by price descending
curl 'http://localhost:3000/odata/Products?$filter=active eq true&$orderby=price desc&$top=10&$select=id,name,price&$expand=category'

# Paginated orders with inline count
curl 'http://localhost:3000/odata/Orders?$top=20&$skip=40&$count=true&$orderby=orderDate desc&$expand=customer'
```

### Counting

```bash
# Total number of active products
curl 'http://localhost:3000/odata/Products/$count?$filter=active eq true'

# Inline count with collection response
curl 'http://localhost:3000/odata/Products?$count=true&$top=5'
```

### $batch

Send multiple operations in a single HTTP request. The batch endpoint is auto-registered at `POST /odata/$batch`:

```bash
curl -X POST http://localhost:3000/odata/\$batch \
  -H 'Content-Type: application/json' \
  -d '{
    "requests": [
      {
        "id": "1",
        "method": "POST",
        "url": "/odata/Orders",
        "headers": { "Content-Type": "application/json" },
        "body": {
          "orderDate": "2025-06-15T10:30:00Z",
          "totalAmount": 149.97,
          "status": "pending",
          "customerId": 1
        }
      },
      {
        "id": "2",
        "method": "POST",
        "url": "/odata/OrderItems",
        "headers": { "Content-Type": "application/json" },
        "body": {
          "quantity": 3,
          "unitPrice": 49.99,
          "orderId": 1,
          "productId": 1
        }
      },
      {
        "id": "3",
        "method": "GET",
        "url": "/odata/Products?$top=5&$select=id,name,price"
      }
    ]
  }'
```

## Security configuration

### Global limits

Set limits at the module level to prevent resource exhaustion:

```typescript
ODataModule.forRoot({
  serviceRoot: '/odata',
  namespace: 'Default',
  maxTop: 500,          // Cap $top to 500 entities per request (default: 1000)
  maxExpandDepth: 2,    // Limit $expand nesting to 2 levels (default: 2)
  maxFilterDepth: 10,   // Limit $filter AST depth (default: 10)
}),
```

Requests exceeding these limits receive an HTTP 400 response with an OData-compliant error message.

### Per-entity overrides

Individual entity sets can have tighter or looser limits than the global defaults using `ODataEntitySecurityOptions`. This is configured through the `EdmRegistry`:

```typescript
// Allow Products to return up to 2000 rows (overriding global maxTop of 500)
edmRegistry.setEntitySecurityOptions('Products', { maxTop: 2000 })

// Restrict OrderItems to 100 rows max
edmRegistry.setEntitySecurityOptions('OrderItems', { maxTop: 100 })
```

Per-entity settings take precedence over global options. If no per-entity override is set, the global limit applies.

## Expected responses

**Products with expanded category** (`GET /odata/Products?$expand=category`):

```json
{
  "@odata.context": "http://localhost:3000/odata/$metadata#Products",
  "value": [
    {
      "id": 1,
      "name": "Widget Pro",
      "description": "Professional-grade widget",
      "price": 49.99,
      "active": true,
      "createdAt": "2025-01-15T00:00:00.000Z",
      "categoryId": 1,
      "category": {
        "id": 1,
        "name": "Widgets"
      }
    }
  ]
}
```

**Orders with nested expand** (`GET /odata/Orders?$expand=items($expand=product)`):

```json
{
  "@odata.context": "http://localhost:3000/odata/$metadata#Orders",
  "value": [
    {
      "id": 1,
      "orderDate": "2025-06-15T10:30:00.000Z",
      "totalAmount": 149.97,
      "status": "pending",
      "customerId": 1,
      "items": [
        {
          "id": 1,
          "quantity": 3,
          "unitPrice": 49.99,
          "orderId": 1,
          "productId": 1,
          "product": {
            "id": 1,
            "name": "Widget Pro",
            "price": 49.99
          }
        }
      ]
    }
  ]
}
```

**Collection with inline count** (`GET /odata/Products?$count=true&$top=2`):

```json
{
  "@odata.context": "http://localhost:3000/odata/$metadata#Products",
  "@odata.count": 42,
  "value": [
    { "id": 1, "name": "Widget Pro", "price": 49.99 },
    { "id": 2, "name": "Gadget Lite", "price": 19.99 }
  ]
}
```
