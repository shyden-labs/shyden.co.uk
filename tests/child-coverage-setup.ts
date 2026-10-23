import { measureChildren } from './child-coverage';

// Inside each integration fork, after it has started (#936).
measureChildren(process.env);
