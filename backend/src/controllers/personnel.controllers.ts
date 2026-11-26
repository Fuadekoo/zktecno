import { ENDPOINTS } from '../biotime/endpoints.js';
import { employeesRepo } from '../repositories/employees.js';
import { areasRepo, departmentsRepo, positionsRepo } from '../repositories/orgUnits.js';
import { config } from '../config.js';
import { deviceCommands } from '../services/deviceCommands.service.js';
import { syncService } from '../services/sync.service.js';
import { biotimeResourceController } from './biotimeResource.controller.js';

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Department/position/area renames change names shown on punches: refresh the employee mirror. */
const refreshEmployees = () => syncService.requestEmployeeSync();

export const devicesController = biotimeResourceController({
  path: ENDPOINTS.terminals,
  entity: 'device',
  filters: ['sn', 'alias', 'area', 'state'],
  label: (r) => `device ${s(r.alias) || s(r.sn)}`,
});

export const employeesController = biotimeResourceController({
  path: ENDPOINTS.employees,
  entity: 'employee',
  filters: ['emp_code', 'first_name', 'last_name', 'department', 'area', 'position', 'app_status'],
  label: (r) => `employee ${[s(r.first_name), s(r.last_name)].filter(Boolean).join(' ')} (${s(r.emp_code) || s(r.id)})`.replace(' ()', ''),
  afterWrite: async (action, id) => {
    if (action === 'delete') await employeesRepo.markDeleted(id);
    refreshEmployees();
    // BioTime off: this dashboard sends people to the devices itself (BioTime does it when it's on)
    if (!config.biotime.enabled) {
      const e = await employeesRepo.byIdAny(id);
      if (!e) return;
      const r = action === 'delete' ? await deviceCommands.removeEmployee(e.empCode) : await deviceCommands.pushEmployee(e, null, action === 'create');
      if (r.skipped.length) console.warn(`[commands] ${e.empCode}: not sent to some devices: ${r.skipped.join('; ')}`);
    }
  },
  local: {
    list: employeesRepo.listLocal,
    get: employeesRepo.getLocal,
    create: employeesRepo.createLocal,
    update: employeesRepo.updateLocal,
    remove: employeesRepo.removeLocal,
  },
});

export const departmentsController = biotimeResourceController({
  path: ENDPOINTS.departments,
  entity: 'department',
  filters: ['dept_code', 'dept_name', 'parent_dept'],
  label: (r) => `department ${s(r.dept_name)} (${s(r.dept_code)})`,
  afterWrite: refreshEmployees,
  local: departmentsRepo,
});

export const areasController = biotimeResourceController({
  path: ENDPOINTS.areas,
  entity: 'area',
  filters: ['area_code', 'area_name', 'parent_area'],
  label: (r) => `area ${s(r.area_name)} (${s(r.area_code)})`,
  afterWrite: refreshEmployees,
  local: areasRepo,
});

export const positionsController = biotimeResourceController({
  path: ENDPOINTS.positions,
  entity: 'position',
  filters: ['position_code', 'position_name', 'parent_position'],
  label: (r) => `position ${s(r.position_name)} (${s(r.position_code)})`,
  afterWrite: refreshEmployees,
  local: positionsRepo,
});
