/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { schema } from '@osd/config-schema';
import { IRouter } from '../../../../core/server';
import { ROUTES } from '../../common/constants';
import { validateCode } from '../../common/code_validator';

export function registerValidateRoute(router: IRouter) {
  router.post(
    {
      path: ROUTES.VALIDATE,
      validate: {
        body: schema.object({
          code: schema.string(),
        }),
      },
    },
    async (_context, request, response) => {
      const result = validateCode(request.body.code);
      return response.ok({ body: result });
    }
  );
}
