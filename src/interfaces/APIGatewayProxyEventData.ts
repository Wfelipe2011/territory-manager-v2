export interface APIGatewayProxyEventData<T = object> {
  requestContext: {
    authorizer: {
      data: string
    }
  }
  body: T
}
