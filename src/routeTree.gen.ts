import { Route as rootRoute } from './routes/__root'
import { Route as indexRoute } from './routes/index'
import { Route as loginRoute } from './routes/login'
import { Route as oauthCallbackRoute } from './routes/oauth.callback'
import { Route as handleRoute } from './routes/$handle'

/** Route tree used by TanStack Router until file-route code generation is introduced. */
export const routeTree = rootRoute.addChildren([indexRoute, loginRoute, oauthCallbackRoute, handleRoute])
