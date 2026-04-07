/**
 * Visitor interface for OData v4 filter AST traversal.
 * One visit method per FilterNode variant, using the discriminated union `kind` field.
 *
 * Usage:
 * ```typescript
 * class SqlVisitor implements FilterVisitor<string> {
 *   visitBinaryExpr(node: BinaryExprNode): string {
 *     return `${this.visit(node.left)} ${node.operator.toUpperCase()} ${this.visit(node.right)}`
 *   }
 *   // ... other visit methods
 *   visit(node: FilterNode): string {
 *     switch (node.kind) {
 *       case 'BinaryExpr': return this.visitBinaryExpr(node)
 *       // ...
 *     }
 *   }
 * }
 * ```
 */

import type {
  BinaryExprNode,
  FilterNode,
  FunctionCallNode,
  LambdaExprNode,
  LiteralNode,
  PropertyAccessNode,
  UnaryExprNode,
} from './ast.js'

/**
 * Generic visitor interface for FilterNode AST traversal.
 * Implement this interface to transform or analyze OData filter expressions.
 *
 * @template T - The return type of each visit method
 */
export interface FilterVisitor<T> {
  visitBinaryExpr(node: BinaryExprNode): T
  visitUnaryExpr(node: UnaryExprNode): T
  visitFunctionCall(node: FunctionCallNode): T
  visitLambdaExpr(node: LambdaExprNode): T
  visitPropertyAccess(node: PropertyAccessNode): T
  visitLiteral(node: LiteralNode): T
}

/**
 * Dispatch a FilterNode to the appropriate visitor method.
 * Convenience function to avoid writing switch statements in every visitor.
 */
export function acceptVisitor<T>(node: FilterNode, visitor: FilterVisitor<T>): T {
  switch (node.kind) {
    case 'BinaryExpr':
      return visitor.visitBinaryExpr(node)
    case 'UnaryExpr':
      return visitor.visitUnaryExpr(node)
    case 'FunctionCall':
      return visitor.visitFunctionCall(node)
    case 'LambdaExpr':
      return visitor.visitLambdaExpr(node)
    case 'PropertyAccess':
      return visitor.visitPropertyAccess(node)
    case 'Literal':
      return visitor.visitLiteral(node)
  }
}
