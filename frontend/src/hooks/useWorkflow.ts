import { create } from 'zustand';
import type { AssignmentPart, ReviewResult, ReviewStatus } from '@/lib/api';

export type WorkflowStep = 'select' | 'upload' | 'build' | 'run' | 'review';
export type StepStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'warning';

interface WorkflowState {
  // Current page and step
  currentPage: 'select' | 'workflow';
  currentStep: WorkflowStep;
  
  // Step statuses
  stepStatuses: Record<WorkflowStep, StepStatus>;
  
  // Assignment data
  assignments: AssignmentPart[];
  selectedAssignmentId: number | null;
  
  // Project info
  projectName: string | null;
  
  // Outputs
  buildOutput: string;
  runOutput: string;
  reviewOutput: string;
  
  // Review data
  reviewStatus: ReviewStatus['status'];
  reviewResult: ReviewResult | null;
  
  // Error handling
  error: string | null;
  errorStep: WorkflowStep | null;
  
  // Actions
  setAssignments: (assignments: AssignmentPart[]) => void;
  selectAssignment: (id: number) => void;
  setProjectName: (name: string) => void;
  goToPage: (page: 'select' | 'workflow') => void;
  goToStep: (step: WorkflowStep) => void;
  canNavigateToStep: (step: WorkflowStep) => boolean;
  setStepStatus: (step: WorkflowStep, status: StepStatus) => void;
  appendBuildOutput: (text: string) => void;
  appendRunOutput: (text: string) => void;
  appendReviewOutput: (text: string) => void;
  setReviewStatus: (status: ReviewStatus['status']) => void;
  setReviewResult: (result: ReviewResult | null) => void;
  setError: (error: string, step: WorkflowStep) => void;
  clearError: () => void;
  reset: () => void;
}

const initialStepStatuses: Record<WorkflowStep, StepStatus> = {
  select: 'pending',
  upload: 'pending',
  build: 'pending',
  run: 'pending',
  review: 'pending',
};

export const useWorkflow = create<WorkflowState>((set, get) => ({
  currentPage: 'select',
  currentStep: 'upload',
  stepStatuses: { ...initialStepStatuses },
  assignments: [],
  selectedAssignmentId: null,
  projectName: null,
  buildOutput: '',
  runOutput: '',
  reviewOutput: '',
  reviewStatus: 'idle',
  reviewResult: null,
  error: null,
  errorStep: null,

  setAssignments: (assignments) => set({ assignments }),

  selectAssignment: (id) => set({ 
    selectedAssignmentId: id,
    stepStatuses: { 
      ...get().stepStatuses,
      select: 'completed',
    },
  }),

  setProjectName: (name) => set({ projectName: name }),

  goToPage: (page) => set({ currentPage: page }),

  goToStep: (step) => {
    const { canNavigateToStep } = get();
    if (canNavigateToStep(step)) {
      set({ currentStep: step });
    }
  },

  canNavigateToStep: (step) => {
    const { stepStatuses, currentStep } = get();
    const stepOrder: WorkflowStep[] = ['select', 'upload', 'build', 'run', 'review'];
    const currentIndex = stepOrder.indexOf(currentStep);
    const targetIndex = stepOrder.indexOf(step);
    
    // Can always go back to completed steps
    if (targetIndex < currentIndex) {
      return stepStatuses[step] === 'completed' || stepStatuses[step] === 'warning';
    }
    
    // Can go to current step
    if (targetIndex === currentIndex) {
      return true;
    }
    
    // Can only go forward if all previous steps are completed
    for (let i = 0; i < targetIndex; i++) {
      const status = stepStatuses[stepOrder[i]];
      if (status !== 'completed' && status !== 'warning') {
        return false;
      }
    }
    
    return true;
  },

  setStepStatus: (step, status) => set({
    stepStatuses: { ...get().stepStatuses, [step]: status },
  }),

  appendBuildOutput: (text) => set({ buildOutput: get().buildOutput + text }),
  appendRunOutput: (text) => set({ runOutput: get().runOutput + text }),
  appendReviewOutput: (text) => set({ reviewOutput: get().reviewOutput + text }),

  setReviewStatus: (status) => set({ reviewStatus: status }),
  setReviewResult: (result) => set({ reviewResult: result }),

  setError: (error, step) => set({ 
    error, 
    errorStep: step,
    stepStatuses: { ...get().stepStatuses, [step]: 'failed' },
  }),

  clearError: () => set({ error: null, errorStep: null }),

  reset: () => set({
    currentPage: 'select',
    currentStep: 'upload',
    stepStatuses: { ...initialStepStatuses },
    selectedAssignmentId: null,
    projectName: null,
    buildOutput: '',
    runOutput: '',
    reviewOutput: '',
    reviewStatus: 'idle',
    reviewResult: null,
    error: null,
    errorStep: null,
  }),
}));
