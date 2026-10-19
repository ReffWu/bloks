// The shapes (src/lib/genui/schema.ts), each paired with how it is
// drawn. A shape with no renderer here does not compile, so the library
// the chat draws with can never fall behind the one the prompt teaches.
import { createLibrary, type ComponentRenderer, type DefinedComponent } from "@openuidev/react-lang";
import { GENUI_GROUPS, GENUI_ROOT, GENUI_SHAPES, type GenUiShapeName } from "@/lib/genui/schema";
import * as parts from "./parts";
import * as charts from "./charts";
import * as forms from "./forms";

const DRAWN: Record<GenUiShapeName, ComponentRenderer<any>> = {
  Card: parts.Card,
  CardHeader: parts.CardHeader,
  TextContent: parts.TextContent,
  Callout: parts.Callout,
  Separator: parts.Separator,
  Image: parts.Image,
  CodeBlock: parts.CodeBlock,
  Quote: parts.Quote,
  TagBlock: parts.TagBlock,
  Tag: parts.Tag,
  MetricIndicator: parts.MetricIndicator,
  Table: parts.Table,
  Col: parts.Inner,
  BarChart: charts.BarChart,
  LineChart: charts.LineChart,
  PieChart: charts.PieChart,
  Series: parts.Inner,
  Steps: parts.Steps,
  StepsItem: parts.Inner,
  ListBlock: parts.ListBlock,
  ListItem: parts.Inner,
  OptionCards: parts.OptionCards,
  OptionCard: parts.Inner,
  Sources: parts.Sources,
  Tabs: parts.Tabs,
  TabItem: parts.Inner,
  Accordion: parts.Accordion,
  AccordionItem: parts.Inner,
  Buttons: parts.Buttons,
  Button: parts.Button,
  FollowUpBlock: parts.FollowUpBlock,
  FollowUpItem: parts.Inner,
  Form: forms.Form,
  FormControl: forms.FormControl,
  Input: forms.Input,
  TextArea: forms.TextArea,
  Select: forms.Select,
  SelectItem: parts.Inner,
  RadioGroup: forms.RadioGroup,
  RadioItem: parts.Inner,
  CheckBoxGroup: forms.CheckBoxGroup,
  CheckBoxItem: parts.Inner,
  Slider: forms.Slider,
  DatePicker: forms.DatePicker,
};

export const genuiLibrary = createLibrary({
  root: GENUI_ROOT,
  componentGroups: GENUI_GROUPS,
  components: GENUI_SHAPES.map(
    (shape) => ({ ...shape, component: DRAWN[shape.name] }) as unknown as DefinedComponent,
  ),
});
